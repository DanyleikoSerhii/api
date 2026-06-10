# Movie Explorer — Backend Implementation Plan

> Статус: **pending approval** (план утверждён консенсусом Planner / Architect / Critic; дополнен по запросу: каст из `title.principals.tsv` и сериалы из `title.episode.tsv`. Реализация не начата).
> Стек: Hono + TypeScript (Node.js), PostgreSQL + Drizzle ORM, zod v4 + OpenAPI, vitest, docker-compose, pnpm.
> Источник данных: официальные IMDb Non-Commercial TSV-дампы, уже лежащие в `seeds/` (~10 GB, gitignored).

---

## Принципы проектирования

1. **Простота важнее гибкости** — учебный проект без enterprise-паттернов (нет DI-контейнеров, event bus, CQRS).
2. **SQL как главный инструмент** — фильтрация, поиск, пагинация реализуются в SQL через Drizzle, а не в прикладном коде.
3. **Типобезопасность сквозная** — схемы Drizzle → типы TypeScript → схемы Zod → OpenAPI-контракт без ручного дублирования; `@hono/zod-openapi` используется с фазы 3.
4. **Итеративная верификация** — каждая фаза заканчивается конкретной командой проверки; нельзя переходить дальше без зелёного статуса.
5. **Учебная прозрачность** — комментарии только там, где решение неочевидно; структура файлов отражает архитектурный слой.

## Decision Drivers (топ-3)

1. **Образовательная ценность** — SQL-индексы, JWT-флоу, миграции, потоковая обработка больших файлов.
2. **Минимальное время до работающего прототипа.**
3. **Консистентность стека** — всё в экосистеме Node.js/TypeScript.

---

## Ключевые решения (рассмотренные варианты)

### 1. Хранение жанров: junction table vs `text[]`

| | Junction table (`genres` + `title_genres`) | `text[]` в `titles` |
|---|---|---|
| Плюсы | Нормализована, фильтрация через `JOIN`, изучаемо | Проще схема, меньше кода |
| Минусы | 2 дополнительные таблицы | Фильтр через `ANY()`, не нормализовано |

**Выбрано: junction table.** Стандартное many-to-many — именно то, что стоит изучить. Жанры в IMDb-датасете идут через запятую в одной колонке; разбиение и нормализация при сиде — наглядный ETL-урок.

### 2. Поиск: `ILIKE` + pg_trgm vs Full-Text Search

| | `ILIKE '%q%'` + GIN trigram | FTS (`tsvector`) |
|---|---|---|
| Плюсы | Тривиально в Drizzle, частичное совпадение | Ранжирование, быстро на больших объёмах |
| Минусы | Нужен GIN-индекс `pg_trgm` | Сложнее, нет частичного совпадения по умолчанию |

**Выбрано: `ILIKE` с GIN-индексом `pg_trgm`.** Для ~1700 записей FTS избыточен; включение расширения и создание GIN-индекса — ценный урок об индексах.

### 3. Пагинация: offset vs cursor

| | Offset (`LIMIT/OFFSET`) | Cursor (keyset) |
|---|---|---|
| Плюсы | Интуитивен, номера страниц | Стабилен при вставках, масштабируется |
| Минусы | Drift на глубоких страницах | Сложнее, нет номеров страниц |

**Выбрано: offset.** Фронтенд ожидает номера страниц; датасет маленький.

### 4. JWT: встроенный `hono/jwt` vs `jsonwebtoken`

| | `hono/jwt` | `jsonwebtoken` |
|---|---|---|
| Плюсы | Promise-based, типизация через Hono Variables, нет внешней зависимости | Широко известен |
| Минусы | Меньше примеров вне Hono | Лишний пакет + `@types`, другой стиль API |

**Выбрано: `hono/jwt`** (sign/verify встроены в пакет `hono`). Только access token, TTL 24h — refresh-токены избыточны для учебного проекта.

### 5. Постеры: placeholder vs TMDB API vs NULL

IMDb Non-Commercial dumps не содержат постеров и описаний сюжета.

**Выбрано: placeholder URL** вида `https://placehold.co/300x450?text=<encodeURIComponent(title)>`, генерируется в seed-скрипте. Колонка `poster_url` — nullable. TMDB-интеграция возможна как отдельный будущий этап (out of scope).

### 6. Сериалы в каталоге: единая таблица `titles` vs отдельная таблица `series`

| | Единая `titles` с колонкой `type` | Отдельные `movies` + `series` |
|---|---|---|
| Плюсы | Один поиск/фильтр/пагинация и одно избранное для всего каталога; нет дублирования роутов | «Чистые» сущности без nullable-колонок |
| Минусы | `seasons_count`/`episodes_count`/`end_year` — NULL для фильмов | Дублирование эндпоинтов, JOIN-ов, тестов; избранное двух видов |

**Выбрано: единая таблица `titles`** с `type: 'movie' | 'series'` (`as const`, не enum). Сериал = `titleType` `tvSeries` или `tvMiniSeries` из датасета. Эндпоинты переименованы в `/api/titles` (фильтр `?type=`), избранное ссылается на `title_id`.

### 7. Каст: нормализация `people` + `title_cast` vs JSON-колонка

| | `people` + `title_cast` (junction) | `jsonb` колонка `cast` в `titles` |
|---|---|---|
| Плюсы | Нормализовано, один актёр — одна запись, второй many-to-many урок | Проще вставка, нет JOIN |
| Минусы | Ещё 2 таблицы, JOIN на детальной странице | Дублирование имён, нельзя фильтровать по актёру |

**Выбрано: `people` + `title_cast`.** Топ-10 актёров по `ordering` из `title.principals.tsv` (category `actor`/`actress`), с именем персонажа. Колонка `director` в `titles` остаётся denormalized varchar — резолюция одного имени при сиде проще, чем JOIN ради единственного поля (компромисс зафиксирован сознательно; нормализация режиссёров через `people` — возможный follow-up).

---

## API Surface

### Единый формат ошибок

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": {}
  }
}
```

Коды ошибок (`as const` объект): `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.
Статусы: 400, 401, 404, 409, 500.

### Auth

#### `POST /api/auth/register`
Request: `{ "email": "user@example.com", "password": "secret123" }`
Response `201`: `{ "token": "<jwt>", "user": { "id": 1, "email": "user@example.com" } }`
Errors: 400, 409 (email занят)

#### `POST /api/auth/login`
Request: `{ "email": "user@example.com", "password": "secret123" }`
Response `200`: `{ "token": "<jwt>", "user": { "id": 1, "email": "user@example.com" } }`
Errors: 400, 401

#### `GET /api/auth/me`
Headers: `Authorization: Bearer <token>`
Response `200`: `{ "id": 1, "email": "user@example.com" }`
Errors: 401

### Titles

#### `GET /api/titles`

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Поиск по title (ILIKE) |
| `type` | 'movie' \| 'series' | — | Фильтр по типу тайтла |
| `year` | number | — | Фильтр по году выхода (startYear) |
| `genre` | string | — | Фильтр по жанру |
| `page` | number | 1 | Номер страницы |
| `limit` | number | 20 | Размер страницы (max 100) |

Response `200`:
```json
{
  "data": [
    {
      "id": 1,
      "type": "movie",
      "title": "The Shawshank Redemption",
      "year": 1994,
      "director": "Frank Darabont",
      "rating": 9.3,
      "posterUrl": "https://placehold.co/300x450?text=The+Shawshank+Redemption",
      "genres": ["Drama", "Crime"]
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 245, "totalPages": 13 }
}
```

`total` считается отдельным `SELECT COUNT(*)` с теми же WHERE-условиями — читаемо и явно (оконная функция `COUNT(*) OVER()` — рабочая альтернатива, но менее наглядна в Drizzle).

#### `GET /api/titles/:id`

Response `200`:
```json
{
  "id": 42,
  "type": "series",
  "title": "Breaking Bad",
  "year": 2008,
  "endYear": 2013,
  "director": "Vince Gilligan",
  "description": null,
  "rating": 9.5,
  "posterUrl": "https://placehold.co/300x450?text=Breaking+Bad",
  "genres": ["Crime", "Drama", "Thriller"],
  "seasonsCount": 5,
  "episodesCount": 62,
  "cast": [
    { "id": 7, "name": "Bryan Cranston", "character": "Walter White" }
  ],
  "isFavorite": false
}
```

- Для фильмов `endYear`, `seasonsCount`, `episodesCount` — `null`.
- `cast` — до 10 актёров, отсортированы по `ord` (IMDb ordering).
- В фазе 3 `isFavorite` всегда `false` (константа, комментарий `// wired up in Phase 4`).
- В фазе 4 `optionalAuth` + `LEFT JOIN favorites` проставляет реальное значение.
- `description` — всегда `null` в этой версии (см. Data Model).

Errors: 404

#### `GET /api/genres`
Response `200`: `{ "data": ["Action", "Crime", "Drama", "Thriller"] }` — алфавитный порядок.

### Favorites (все требуют авторизации)

#### `GET /api/favorites`
Response `200`: тот же формат, что `/api/titles` (data + pagination).

#### `POST /api/favorites/:titleId`
Response `201`: `{ "titleId": 1, "addedAt": "2026-06-10T12:00:00Z" }`
Errors: 401, 404 (тайтл не существует), 409 (уже в избранном)

#### `DELETE /api/favorites/:titleId`
Response `204` (no body)
Errors: 401, 404 — пара `(user_id, title_id)` в `favorites` не найдена; существование самого тайтла при DELETE не проверяется.

---

## Data Model

### `users`

| Колонка | Тип | Constraints |
|---|---|---|
| `id` | serial PK | |
| `email` | varchar(255) | UNIQUE NOT NULL |
| `password_hash` | varchar(255) | NOT NULL |
| `created_at` | timestamp | DEFAULT now() |

### `titles`

| Колонка | Тип | Constraints |
|---|---|---|
| `id` | serial PK | |
| `imdb_id` | varchar(20) | UNIQUE NOT NULL (tconst; защита от дублей при повторном seed) |
| `type` | varchar(10) | NOT NULL — `'movie'` \| `'series'` (CHECK constraint; в TS — `as const` объект) |
| `title` | varchar(500) | NOT NULL |
| `year` | smallint | NOT NULL (startYear) |
| `end_year` | smallint | NULL — только для завершённых сериалов |
| `director` | varchar(255) | NULL (для сериалов — первый указанный в crew, обычно создатель/основной режиссёр) |
| `description` | text | NULL — всегда NULL в текущей версии: IMDb dumps не содержат описаний сюжета; зарезервировано для будущей TMDB-интеграции |
| `rating` | numeric(3,1) | NOT NULL |
| `num_votes` | integer | NOT NULL |
| `seasons_count` | smallint | NULL — только для series (max seasonNumber) |
| `episodes_count` | integer | NULL — только для series |
| `poster_url` | varchar(1000) | NULL |
| `created_at` | timestamp | DEFAULT now() |

Индексы:
- GIN на `title` через `pg_trgm` — для ILIKE-поиска
- B-tree на `year` — для фильтрации
- B-tree на `type` — для фильтра movie/series
- B-tree на `rating DESC` — сортировка по умолчанию
- UNIQUE на `imdb_id`

### `genres`

| Колонка | Тип | Constraints |
|---|---|---|
| `id` | serial PK | |
| `name` | varchar(100) | UNIQUE NOT NULL |

### `title_genres`

| Колонка | Тип | Constraints |
|---|---|---|
| `title_id` | integer | FK → titles.id ON DELETE CASCADE |
| `genre_id` | integer | FK → genres.id ON DELETE CASCADE |

PK: составной `(title_id, genre_id)`. Индекс на `genre_id` для JOIN.

### `people`

| Колонка | Тип | Constraints |
|---|---|---|
| `id` | serial PK | |
| `imdb_id` | varchar(20) | UNIQUE NOT NULL (nconst) |
| `name` | varchar(255) | NOT NULL |

### `title_cast`

| Колонка | Тип | Constraints |
|---|---|---|
| `title_id` | integer | FK → titles.id ON DELETE CASCADE |
| `person_id` | integer | FK → people.id ON DELETE CASCADE |
| `character` | varchar(500) | NULL — первый элемент JSON-массива `characters` из principals |
| `ord` | smallint | NOT NULL — IMDb ordering, для сортировки каста |

PK: составной `(title_id, ord)`. Индекс на `person_id`.

### `favorites`

| Колонка | Тип | Constraints |
|---|---|---|
| `user_id` | integer | FK → users.id ON DELETE CASCADE |
| `title_id` | integer | FK → titles.id ON DELETE CASCADE |
| `added_at` | timestamp | DEFAULT now() |

PK: составной `(user_id, title_id)`.

---

## Структура проекта

```
/api
├── docker-compose.yml
├── .env.example
├── .env                          # gitignored
├── .gitignore                    # seeds/, .env, node_modules/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── vitest.config.ts
├── seeds/                        # gitignored — IMDb TSV dumps (скачиваются вручную)
│   ├── title.basics.tsv
│   ├── title.ratings.tsv
│   ├── title.crew.tsv
│   ├── title.episode.tsv
│   ├── title.principals.tsv
│   └── name.basics.tsv           # (title.akas.tsv не используется)
├── src/
│   ├── index.ts                  # entrypoint: запуск сервера
│   ├── app.ts                    # Hono app factory (без .listen — для тестов)
│   ├── env.ts                    # парсинг process.env через zod
│   ├── db/
│   │   ├── connection.ts         # drizzle instance + pg pool
│   │   └── schema.ts             # все таблицы Drizzle
│   ├── seed/
│   │   └── run.ts                # ETL-скрипт: TSV → PostgreSQL (streaming)
│   ├── lib/
│   │   ├── jwt.ts                # sign / verify через hono/jwt
│   │   ├── password.ts           # hash / compare через bcryptjs
│   │   └── errors.ts             # AppError, errorHandler, коды ошибок
│   ├── middleware/
│   │   ├── auth.ts               # requireAuth
│   │   └── optionalAuth.ts       # optionalAuth
│   ├── routes/
│   │   ├── index.ts              # монтирует все роуты
│   │   ├── auth.ts
│   │   ├── titles.ts
│   │   ├── genres.ts
│   │   └── favorites.ts
│   └── openapi/
│       └── spec.ts               # app.doc() + swagger-ui
├── drizzle/
│   └── migrations/
└── tests/
    ├── helpers/
    │   ├── db.ts                 # тестовая БД: migrate + truncate helpers
    │   └── request.ts            # обёртка над app.request()
    ├── auth.test.ts
    ├── titles.test.ts
    ├── genres.test.ts
    └── favorites.test.ts
```

---

## Фазы реализации

### Фаза 0: Scaffolding

**Задачи:**
1. `pnpm init`; runtime-зависимости: `hono`, `@hono/node-server`, `@hono/zod-openapi`, `@hono/swagger-ui`, `drizzle-orm`, `pg`, `bcryptjs`, `zod@^4.0.0`
2. Dev-зависимости: `drizzle-kit`, `typescript`, `tsx`, `@types/node`, `@types/pg`, `@types/bcryptjs`, `vitest`, `@vitest/coverage-v8`
3. `tsconfig.json`: `strict: true`, `moduleResolution: bundler`, `target: ES2022`
4. `docker-compose.yml`: `postgres:16-alpine`, порт 5432, named volume
5. `.env.example`: `DATABASE_URL`, `DATABASE_URL_TEST`, `JWT_SECRET`, `PORT`; создать локальный `.env`
6. `.gitignore`: `seeds/`, `.env`, `node_modules/`
7. `src/env.ts` — zod-парсинг переменных окружения
8. `src/app.ts` — Hono app factory с `GET /health → { status: "ok" }`
9. `src/index.ts` — запуск через `@hono/node-server`
10. Скрипты: `dev` (tsx watch), `build` (tsc), `start`, `db:generate`, `db:migrate`, `db:seed`, `test`

Примечания:
- `@hono/zod-openapi@1.x` требует `zod@^4.0.0` (peerDependency). Большинство онлайн-примеров написаны под zod v3: `.nonempty()` удалён — использовать `.min(1)`.
- `@hono/zod-validator` НЕ устанавливается — полностью заменён `@hono/zod-openapi`.

**Acceptance criteria:**
- `docker compose up -d` — контейнер healthy
- `curl http://localhost:3000/health` → `{"status":"ok"}`
- `npx tsc --noEmit` — 0 ошибок

### Фаза 1: Database schema + migrations

**Задачи:**
1. `src/db/schema.ts` — таблицы `users`, `titles`, `genres`, `title_genres`, `people`, `title_cast`, `favorites` через `pgTable`
2. `drizzle.config.ts` — `DATABASE_URL`, папка `drizzle/migrations`
3. Первая миграция: `CREATE EXTENSION IF NOT EXISTS pg_trgm`, все таблицы, GIN-индекс на `titles.title`, B-tree на `year`, `type`, `rating DESC`, CHECK на `type IN ('movie','series')`
4. `pnpm run db:generate` + `pnpm run db:migrate`

**Acceptance criteria:**
- `pnpm run db:migrate` без ошибок
- `psql $DATABASE_URL -c "\dt"` — 7 таблиц
- `psql $DATABASE_URL -c "\di titles*"` — GIN и B-tree индексы на месте
- `npx tsc --noEmit` — 0 ошибок

### Фаза 2: ETL seed (IMDb TSV → PostgreSQL)

Наиболее трудоёмкая нетривиальная часть проекта. Скрипт читает файлы потоково через `readline` (Node.js built-in) — никогда не загружая весь файл в память.

**Пороги по умолчанию** (именованные константы вверху `seed/run.ts`):

```ts
const MIN_RATING = 7.5;
const MIN_VOTES = 50_000;
const MAX_CAST = 10;
```

Замерено на реальных TSV: 1927 qualifying tconst → **1722 тайтла** (1159 movies + 563 series), каст покрывает 1685 тайтлов (97.9%, 16 770 записей, 10 738 уникальных актёров). Перед вставкой скрипт печатает `Qualified: N titles (M movies, S series)` — если N вне [500, 2500], скорректировать константы и перезапустить.

**Алгоритм: шесть потоковых проходов**

**Проход 1 — qualifying set по рейтингу.** `seeds/title.ratings.tsv` (~1.7M строк, 28 MB): если `averageRating >= MIN_RATING AND numVotes >= MIN_VOTES` — добавить `tconst` в `Set<string>` (~2000 записей).

**Проход 2 — фильтрация тайтлов.** `seeds/title.basics.tsv` (~12.5M строк); при несоответствии любому фильтру строка пропускается:
- `tconst` не в `qualifyingTconst` → пропустить (отсеивает ~99% строк, `Set.has()` — O(1))
- `titleType` не в `('movie', 'tvSeries', 'tvMiniSeries')` → пропустить (отсеивает tvEpisode, videoGame и пр.)
- `isAdult === '1'` → пропустить
- `startYear === '\N'` → пропустить (112 584 тайтла с null-годом; схема объявляет `year NOT NULL` — без фильтра seed упадёт на constraint violation)
- `genres === '\N'` → пропустить (77 879 тайтлов без жанра; AC требует хотя бы один жанр)

Прошедшие → `Map<tconst, TitleData>` (ТОЛЬКО qualifying, ~1722 записи): `type` = `'movie'` для movie, `'series'` для tvSeries/tvMiniSeries; `end_year` = endYear (`'\N'` → NULL — идущие сериалы).

Примечание: IMDb иногда указывает жанр `"Adult"` даже при `isAdult=0` — безвредно.

**Проход 3 — сезоны и эпизоды.** `seeds/title.episode.tsv` (~12.5M строк): если `parentTconst` в Map и тайтл — series: `episodes_count++`; `seasons_count = max(seasonNumber)` (игнорировать `'\N'`). Замерено: все 563 сериала имеют строки эпизодов и номера сезонов (44 192 эпизода суммарно). Для фильмов — NULL.

**Проход 4 — режиссёры.** `seeds/title.crew.tsv`: если `tconst` в Map — взять первый `nconst` из `directors`; `'\N'` → `director = null`. Собрать `Set<nconst>` (замерено: 623 уникальных, покрытие 100%).

**Проход 5 — каст.** `seeds/title.principals.tsv` (~4.2 GB — самый долгий проход, но фильтр по Map отсеивает почти всё): если `tconst` в Map, `category` — `actor` или `actress`, `ordering <= MAX_CAST` — сохранить `{tconst, nconst, ordering, character}`. `character` = первый элемент JSON-массива колонки `characters` (`'["Walter White"]'` → `Walter White`; `'\N'` → NULL). Добавить `nconst` в общий Set для резолюции имён (замерено: ~10 738 актёров, ~16 770 записей каста).

**Проход 6 — имена.** `seeds/name.basics.tsv` (~15.4M строк): сохранить `primaryName` ТОЛЬКО для nconst из объединённого Set (режиссёры + актёры, ~11 400 записей) — никогда не загружать все 15.4M имён в память (heap overflow).

**Вставка в БД** (батчами по 100):
- `poster_url` = `https://placehold.co/300x450?text=<encodeURIComponent(title.slice(0, 30))>`
- `description` = `NULL` (всегда; см. Data Model)
- Жанры: `INSERT INTO genres (name) ... ON CONFLICT (name) DO NOTHING`
- Люди: `INSERT INTO people (imdb_id, name) ... ON CONFLICT (imdb_id) DO NOTHING`
- Тайтлы: `INSERT ... ON CONFLICT (imdb_id) DO NOTHING` — идемпотентность при повторном запуске
- Связи `title_genres`, `title_cast`
- Логировать прогресс каждые 1000 строк + итоговую статистику

**Дополнительно:**
- README: _"Movie data provided by IMDb. Used under IMDb Non-Commercial Datasets license for educational purposes only."_
- `seeds/.gitkeep` + инструкция по скачиванию TSV с datasets.imdbws.com

**Acceptance criteria:**
- `pnpm run db:seed` завершается без ошибок, время < 15 минут
- `SELECT COUNT(*) FROM titles` → в диапазоне [500, 2500] (ожидается ~1722)
- `SELECT COUNT(*) FROM titles WHERE type = 'series'` → > 0 (ожидается ~563)
- `SELECT COUNT(*) FROM titles WHERE year IS NULL OR rating IS NULL` → 0
- `SELECT COUNT(*) FROM titles WHERE type = 'series' AND (seasons_count IS NULL OR episodes_count IS NULL)` → 0
- `SELECT COUNT(*) FROM titles t LEFT JOIN title_genres tg ON t.id = tg.title_id WHERE tg.title_id IS NULL` → 0
- Доля тайтлов с `director IS NOT NULL` ≥ 90%
- Доля тайтлов с хотя бы одной записью в `title_cast` ≥ 95% (замерено 97.9%)
- Повторный `pnpm run db:seed` не создаёт дублей
- `npx tsc --noEmit` — 0 ошибок

### Фаза 3: Titles endpoints

**Задачи:**
1. `src/lib/errors.ts`: `AppError`, коды ошибок (`as const`), глобальный error handler в `app.ts`
2. Zod-схемы query/response с `.openapi()` аннотациями
3. `GET /api/titles` через `createRoute`: `q` (ILIKE), `type`, `year`, `genre`, `page`, `limit` (default 20, clamp 100)
4. Отдельный `SELECT COUNT(*)` с теми же WHERE для `pagination.total`
5. `GET /api/titles/:id`: агрегация жанров + JOIN `title_cast` + `people` (сортировка по `ord`), `seasonsCount`/`episodesCount`/`endYear` (NULL для фильмов), `isFavorite: false` константой (`// wired up in Phase 4`), 404
6. `GET /api/genres`: алфавитный порядок
7. `src/routes/index.ts`: монтирование роутов

**Acceptance criteria:**
- `curl "...?q=matrix&limit=5"` → JSON с пагинацией
- `curl "...?type=series"` → только сериалы; `?type=movie` → только фильмы
- `curl "...?genre=Drama&year=1994"` → отфильтровано
- `curl "...?limit=500"` → не более 100
- `curl ".../api/titles/<id сериала>"` → `cast` непустой, `seasonsCount`/`episodesCount` заполнены
- `curl ".../api/titles/<id фильма>"` → `seasonsCount: null`, `endYear: null`
- `curl ".../api/titles/999999"` → `NOT_FOUND` в едином формате
- `npx tsc --noEmit` — 0 ошибок

### Фаза 4: Auth

**Задачи:**
1. `src/lib/password.ts`: `hashPassword` / `verifyPassword` (bcryptjs)
2. `src/lib/jwt.ts`: `signToken` / `verifyToken` через `hono/jwt`; payload `{ sub: number, email: string }`, где `sub` — числовой `users.id` (не email!); `requireAuth` использует `payload.sub` для запросов к БД. TTL 24h
3. `src/routes/auth.ts` — register / login / me через `createRoute`
4. `src/middleware/auth.ts`: `requireAuth` — Bearer, verify в try/catch (hono/jwt бросает исключение на невалидный токен → 401), `c.set('user', payload)` через типизированные Hono Variables
5. `src/middleware/optionalAuth.ts`: то же без 401, `c.set('user', null)`
6. `GET /api/titles/:id` — `optionalAuth` + `LEFT JOIN favorites` для реального `isFavorite`

**Acceptance criteria:**
- register → `201` с токеном; повторно тот же email → `409`
- login с неверным паролем → `401`
- `GET /api/auth/me` с токеном → `200`; без токена → `401`
- `GET /api/titles/1` авторизованным → корректный `isFavorite`
- `npx tsc --noEmit` — 0 ошибок

### Фаза 5: Favorites

**Задачи:**
1. `src/routes/favorites.ts` — 3 эндпоинта с `requireAuth`, через `createRoute`
2. `GET /api/favorites` — JOIN с titles/genres, пагинация как в `/api/titles`
3. `POST /api/favorites/:titleId` — 404 если тайтла нет, 409 если уже в избранном
4. `DELETE /api/favorites/:titleId` — 404 если пары `(user_id, title_id)` нет в `favorites`

**Acceptance criteria:**
- `POST /api/favorites/1` → `201`; повторно → `409`
- `GET /api/favorites` → список с пагинацией
- `DELETE /api/favorites/1` → `204`
- `GET /api/titles/1` после добавления → `"isFavorite": true`
- Все favorites-роуты без токена → `401`
- `npx tsc --noEmit` — 0 ошибок

### Фаза 6: OpenAPI / Swagger UI (polish)

Все роуты уже определены через `createRoute` — фаза только полирует документацию.

**Задачи:**
1. `src/openapi/spec.ts` — `app.doc('/api/openapi.json', { openapi: '3.0.0', info: {...} })`
2. `@hono/swagger-ui` на `/api/docs`
3. `.openapi()` аннотации (description, example) ко всем схемам
4. `BearerAuth` security scheme; `security: [{ BearerAuth: [] }]` на защищённых роутах

**Acceptance criteria:**
- `GET /api/openapi.json` → валидная OpenAPI 3.0 спецификация
- `GET /api/docs` → Swagger UI со всеми эндпоинтами, замки на защищённых
- `npx tsc --noEmit` — 0 ошибок

### Фаза 7: Tests

**Задачи:**
1. `vitest.config.ts` — `environment: 'node'`, `globalSetup`
2. `tests/helpers/db.ts` — globalSetup: подключение к `DATABASE_URL_TEST`, программный мигратор `migrate(db, { migrationsFolder: './drizzle/migrations' })` из `drizzle-orm/node-postgres/migrator`; test-seed 5–10 тайтлов (включая 1–2 сериала с кастом); `truncateAll()` для `users`/`favorites` в `beforeEach`
3. `tests/helpers/request.ts` — обёртка над `app.request()` (встроенный метод Hono, supertest не нужен)
4. `tests/auth.test.ts` — unit (`hashPassword`/`verifyPassword`) + integration (register, login, me, дубликат email)
5. `tests/titles.test.ts` — поиск, фильтры (`type`/`year`/`genre`), пагинация, детальная (включая `cast` и поля сериала), 404, clamp limit
6. `tests/genres.test.ts` — happy-path
7. `tests/favorites.test.ts` — add, 409, list, delete, 401 без токена, isFavorite

**Acceptance criteria:**
- `pnpm test` — все тесты зелёные
- `pnpm test --coverage` — покрытие route-обработчиков ≥ 70%
- Тесты изолированы и не зависят от порядка запуска

### Фаза 8: Polish

**Задачи:**
1. CORS middleware (`hono/cors`)
2. Request logging middleware (метод, путь, статус, время)
3. Rate limiting на auth-эндпоинты — рукописный in-memory sliding window Map (без дополнительных пакетов)
4. Edge cases: `page < 1` → 400, `limit > 100` → clamp до 100, пустой `q` → фильтр игнорируется, невалидный `type` → 400
5. Финальная проверка `.env.example`, `.gitignore`, README (запуск: compose, migrate, seed, dev, test)

**Acceptance criteria:**
- Burst register-запросов → `429`
- `GET /api/titles?page=0` → `400`; `?limit=999` → ≤ 100 результатов; `?type=cartoon` → `400`
- Финальные `npx tsc --noEmit` + `pnpm test` — зелёные

---

## Verification Steps Summary

| Фаза | Команды верификации |
|---|---|
| 0 | `npx tsc --noEmit` + `curl /health` |
| 1 | `pnpm run db:migrate` + `psql \dt` (7 таблиц) + `psql \di titles*` |
| 2 | `pnpm run db:seed` + psql COUNT-проверки (titles, series, cast coverage, genres LEFT JOIN, director %) |
| 3 | `npx tsc --noEmit` + curl поиск / фильтры (вкл. `type`) / cast / clamp / 404 |
| 4 | `npx tsc --noEmit` + curl register / login / me (+/- токен) |
| 5 | `npx tsc --noEmit` + curl favorites CRUD + isFavorite |
| 6 | `npx tsc --noEmit` + `/api/docs` в браузере + валидация openapi.json |
| 7 | `pnpm test` + `pnpm test --coverage` |
| 8 | финальные `npx tsc --noEmit` + `pnpm test` + rate limit smoke test |

---

## Risks & Mitigations

| Риск | Вероятность | Митигация |
|---|---|---|
| ETL над большими TSV выполняется медленно (`principals` — 4.2 GB) | Средняя | Все проходы потоковые; фильтр `Set.has()`/`Map.has()` O(1) отсеивает ~99% строк сразу. Ожидаемое время 5–12 минут; seed одноразовый |
| Пороги дают <500 или >2500 тайтлов | Низкая | `MIN_RATING`/`MIN_VOTES` — константы вверху файла; скрипт печатает `Qualified: N` до вставки. Дефолты 7.5 / 50 000 дают 1722 по замерам на реальных TSV |
| zod v4 несовместим с примерами из интернета | Средняя | `@hono/zod-openapi` требует zod `^4.0.0`; `.nonempty()` удалён → `.min(1)`; при копировании примеров проверять версию |
| Null `startYear` / `genres` в IMDb-данных | Устранён | Фильтры `!== '\N'` в проходе 2 (112 584 null-year, 77 879 null-genre тайтлов в датасете) |
| Колонка `characters` в principals — JSON-строка с экранированием | Низкая | Парсить через `JSON.parse` в try/catch; при ошибке или `'\N'` — `character = NULL` |
| Память: имена и каст в Map | Низкая | Резолюция имён только для ~11 400 nconst (режиссёры + актёры); каст ~16 770 строк — единицы МБ |
| `pg_trgm` не активирован | Низкая | `CREATE EXTENSION IF NOT EXISTS pg_trgm` в первой миграции; входит в `postgres:16-alpine` |
| `hono/jwt` verify бросает исключение | Низкая | try/catch в `requireAuth`/`optionalAuth` → 401 |
| Drizzle не поддерживает нужный запрос | Низкая | Escape hatch: `sql` template literal |
| Тестовая БД конфликтует с dev | Низкая | Отдельный `DATABASE_URL_TEST`; миграции в globalSetup; `truncateAll()` в beforeEach |

---

## ADR: Architecture Decision Record

**Decision.** Бэкенд Movie Explorer строится как монолитный Hono-сервис на Node.js с собственной PostgreSQL-базой тайтлов (фильмы и сериалы в единой таблице `titles`), сидируемой потоковым ETL из локальных IMDb Non-Commercial TSV-дампов (включая каст из `title.principals.tsv` и сезоны/эпизоды из `title.episode.tsv`); JWT-аутентификация через встроенный `hono/jwt`; контракты через zod v4 + `@hono/zod-openapi`.

**Drivers.** Образовательная ценность (SQL, индексы, миграции, streaming ETL, JWT, два many-to-many отношения); минимальное время до прототипа; консистентность TS-стека.

**Alternatives considered.** Прокси к TMDB/OMDb (отклонено пользователем — выбрана своя БД); `text[]` для жанров (junction table учебно ценнее); Postgres FTS (избыточен для ~1700 строк); cursor-пагинация (фронту нужны номера страниц); `jsonwebtoken` (лишняя зависимость); access+refresh токены (избыточно); Prisma / чистый pg (пользователь выбрал Drizzle); поэтапный переход zod-validator → zod-openapi (ненужный rework); отдельные таблицы movies/series (дублирование роутов и избранного); `jsonb`-колонка для каста (не нормализовано, нельзя фильтровать по актёру).

**Why chosen.** Каждое решение максимизирует учебную ценность при минимальной сложности; ключевые числа проверены на реальных TSV-файлах: 1927 qualifying tconst → 1722 тайтла (1159 фильмов + 563 сериала), каст покрывает 97.9% тайтлов (10 738 актёров), 100% сериалов имеют сезоны/эпизоды.

**Consequences.** (+) Полный контроль над данными, нет внешних API и ключей; воспроизводимый идемпотентный seed; сквозная типизация; единые поиск/фильтры/избранное для фильмов и сериалов. (−) `description` всегда NULL и постеры — заглушки до TMDB-интеграции; `director` денормализован (varchar) при наличии таблицы `people`; ETL — самая сложная часть проекта (6 потоковых проходов, в т.ч. 4.2 GB principals); zod v4 — ловушка при копировании v3-примеров.

**Follow-ups.** TMDB-обогащение (описания, реальные постеры); нормализация режиссёров через `people`; эндпоинт `/api/people/:id` с фильмографией; rate limiting на Redis при деплое; refresh-токены при усложнении auth.
