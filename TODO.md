# Movie Explorer Backend — TODO

> Чеклист реализации по [PLAN.md](PLAN.md). Порядок фаз строгий: не переходить к следующей, пока не выполнены все проверки текущей.
> Каталог: фильмы + сериалы (таблица `titles`), каст из `title.principals.tsv`, сезоны/эпизоды из `title.episode.tsv`.

## Фаза 0: Scaffolding

- [ ] `pnpm init`
- [ ] Установить runtime-зависимости: `hono`, `@hono/node-server`, `@hono/zod-openapi`, `@hono/swagger-ui`, `drizzle-orm`, `pg`, `bcryptjs`, `zod@^4.0.0`
- [ ] Установить dev-зависимости: `drizzle-kit`, `typescript`, `tsx`, `@types/node`, `@types/pg`, `@types/bcryptjs`, `vitest`, `@vitest/coverage-v8`
- [ ] `tsconfig.json`: `strict: true`, `moduleResolution: bundler`, `target: ES2022`
- [ ] `docker-compose.yml`: `postgres:16-alpine`, порт 5432, named volume
- [ ] `.env.example`: `DATABASE_URL`, `DATABASE_URL_TEST`, `JWT_SECRET`, `PORT`; создать локальный `.env`
- [ ] `.gitignore`: `seeds/`, `.env`, `node_modules/`
- [ ] `src/env.ts` — zod-парсинг переменных окружения
- [ ] `src/app.ts` — Hono app factory с `GET /health → { status: "ok" }`
- [ ] `src/index.ts` — запуск через `@hono/node-server`
- [ ] Скрипты в `package.json`: `dev`, `build`, `start`, `db:generate`, `db:migrate`, `db:seed`, `test`

**Проверка фазы:**
- [ ] `docker compose up -d` — контейнер healthy
- [ ] `curl http://localhost:3000/health` → `{"status":"ok"}`
- [ ] `npx tsc --noEmit` — 0 ошибок

## Фаза 1: Схема БД + миграции

- [ ] `src/db/schema.ts`: таблицы `users`, `titles` (с `imdb_id` UNIQUE, `type` movie|series, `end_year`, `seasons_count`, `episodes_count`), `genres`, `title_genres`, `people` (`imdb_id` UNIQUE), `title_cast` (PK `(title_id, ord)`, `character` NULL), `favorites` (PK `(user_id, title_id)`)
- [ ] `src/db/connection.ts`: pg pool + drizzle instance
- [ ] `drizzle.config.ts`
- [ ] Миграция: `CREATE EXTENSION IF NOT EXISTS pg_trgm`
- [ ] Миграция: GIN-индекс на `titles.title` (pg_trgm), B-tree на `year`, `type`, `rating DESC`; CHECK `type IN ('movie','series')`
- [ ] `pnpm run db:generate` + `pnpm run db:migrate`

**Проверка фазы:**
- [ ] `psql $DATABASE_URL -c "\dt"` — 7 таблиц
- [ ] `psql $DATABASE_URL -c "\di titles*"` — GIN и B-tree индексы на месте
- [ ] `npx tsc --noEmit` — 0 ошибок

## Фаза 2: ETL seed (IMDb TSV → PostgreSQL)

- [ ] `src/seed/run.ts`: константы `MIN_RATING = 7.5`, `MIN_VOTES = 50_000`, `MAX_CAST = 10` вверху файла
- [ ] Проход 1: stream `seeds/title.ratings.tsv` → `Set<tconst>` (rating >= MIN_RATING, votes >= MIN_VOTES)
- [ ] Проход 2: stream `seeds/title.basics.tsv` с фильтрами (порядок важен):
  - [ ] `tconst` в qualifying Set (первым — отсеивает ~99%)
  - [ ] `titleType` в `('movie', 'tvSeries', 'tvMiniSeries')`
  - [ ] `isAdult === '0'`
  - [ ] `startYear !== '\N'` (иначе NOT NULL constraint уронит seed)
  - [ ] `genres !== '\N'`
  - [ ] результат → `Map<tconst, TitleData>` (~1722 записи); `type` = movie | series; `end_year` (`'\N'` → NULL)
- [ ] Проход 3: stream `seeds/title.episode.tsv` → для series: `episodes_count` = число строк по `parentTconst`, `seasons_count` = max(seasonNumber), `'\N'` игнорировать
- [ ] Проход 4: stream `seeds/title.crew.tsv` → первый `nconst` режиссёра; `'\N'` → `director = null`
- [ ] Проход 5: stream `seeds/title.principals.tsv` (4.2 GB) → `category` actor|actress, `ordering <= MAX_CAST`; `character` = `JSON.parse(characters)[0]` в try/catch (`'\N'`/ошибка → NULL); собрать nconst актёров
- [ ] Проход 6: stream `seeds/name.basics.tsv` → имена ТОЛЬКО для нужных nconst (режиссёры + актёры, ~11 400; не грузить 15.4M имён)
- [ ] Вывод `Qualified: N titles (M movies, S series)` перед вставкой
- [ ] Вставка батчами по 100: `genres` и `people` (`ON CONFLICT DO NOTHING`), `titles` (`ON CONFLICT (imdb_id) DO NOTHING`), `title_genres`, `title_cast`
- [ ] `poster_url` = `https://placehold.co/300x450?text=<encodeURIComponent(title.slice(0, 30))>`; `description = NULL`
- [ ] Лог прогресса каждые 1000 строк + итоговая статистика
- [ ] `seeds/.gitkeep` + инструкция в README по скачиванию с datasets.imdbws.com
- [ ] README: примечание о лицензии IMDb Non-Commercial

**Проверка фазы:**
- [ ] `pnpm run db:seed` без ошибок, < 15 минут
- [ ] `SELECT COUNT(*) FROM titles` → в [500, 2500] (ожидается ~1722)
- [ ] `SELECT COUNT(*) FROM titles WHERE type = 'series'` → ~563
- [ ] `SELECT COUNT(*) FROM titles WHERE year IS NULL OR rating IS NULL` → 0
- [ ] `SELECT COUNT(*) FROM titles WHERE type = 'series' AND (seasons_count IS NULL OR episodes_count IS NULL)` → 0
- [ ] `SELECT COUNT(*) FROM titles t LEFT JOIN title_genres tg ON t.id = tg.title_id WHERE tg.title_id IS NULL` → 0
- [ ] Доля `director IS NOT NULL` >= 90%
- [ ] Доля тайтлов с записями в `title_cast` >= 95% (замерено 97.9%)
- [ ] Повторный `pnpm run db:seed` — без дублей
- [ ] `npx tsc --noEmit` — 0 ошибок

## Фаза 3: Titles endpoints

- [ ] `src/lib/errors.ts`: `AppError`, коды ошибок (`as const`), глобальный error handler в `app.ts`
- [ ] Zod-схемы query/response с `.openapi()` аннотациями
- [ ] `GET /api/titles` через `createRoute`: `q` (ILIKE), `type` (movie|series), `year`, `genre`, `page`, `limit` (default 20, clamp 100)
- [ ] Отдельный `SELECT COUNT(*)` с теми же WHERE для `pagination.total`
- [ ] `GET /api/titles/:id`: жанры + каст (JOIN `title_cast` + `people`, сортировка по `ord`) + `seasonsCount`/`episodesCount`/`endYear` (NULL для фильмов), `isFavorite: false` константой (`// wired up in Phase 4`), 404
- [ ] `GET /api/genres`: алфавитный порядок
- [ ] `src/routes/index.ts`: монтирование роутов

**Проверка фазы:**
- [ ] `curl "...?q=matrix&limit=5"` → JSON с пагинацией
- [ ] `curl "...?type=series"` → только сериалы; `?type=movie` → только фильмы
- [ ] `curl "...?genre=Drama&year=1994"` → отфильтровано
- [ ] `curl "...?limit=500"` → не более 100
- [ ] `curl ".../api/titles/<id сериала>"` → `cast` непустой, `seasonsCount`/`episodesCount` заполнены
- [ ] `curl ".../api/titles/<id фильма>"` → `seasonsCount: null`, `endYear: null`
- [ ] `curl ".../api/titles/999999"` → `NOT_FOUND` в едином формате
- [ ] `npx tsc --noEmit` — 0 ошибок

## Фаза 4: Auth

- [ ] `src/lib/password.ts`: `hashPassword` / `verifyPassword` (bcryptjs)
- [ ] `src/lib/jwt.ts`: `signToken` / `verifyToken` через `hono/jwt`; payload `{ sub: number, email: string }`, `sub` = `users.id`; TTL 24h
- [ ] `POST /api/auth/register`: 201 + token; 409 на дубликат email
- [ ] `POST /api/auth/login`: 200 + token; 401 на неверные креды
- [ ] `GET /api/auth/me`: 200; 401 без токена
- [ ] `src/middleware/auth.ts`: `requireAuth` — Bearer, verify в try/catch → 401, `c.set('user', payload)` через типизированные Variables
- [ ] `src/middleware/optionalAuth.ts`: то же без 401, `c.set('user', null)`
- [ ] `GET /api/titles/:id`: `optionalAuth` + `LEFT JOIN favorites` → реальный `isFavorite`

**Проверка фазы:**
- [ ] curl-флоу: register 201 → повторный 409 → login неверный пароль 401 → me 200 → me без токена 401
- [ ] `npx tsc --noEmit` — 0 ошибок

## Фаза 5: Favorites

- [ ] `GET /api/favorites` (requireAuth): JOIN titles + genres, пагинация как в `/api/titles`
- [ ] `POST /api/favorites/:titleId`: 201; 404 если тайтла нет; 409 если уже в избранном
- [ ] `DELETE /api/favorites/:titleId`: 204; 404 если пары `(user_id, title_id)` нет (существование тайтла не проверяется)

**Проверка фазы:**
- [ ] curl-флоу: add 201 → повторный 409 → list → `GET /api/titles/:id` → `isFavorite: true` → delete 204 → delete повторно 404
- [ ] Все favorites-роуты без токена → 401
- [ ] `npx tsc --noEmit` — 0 ошибок

## Фаза 6: OpenAPI / Swagger UI

- [ ] `src/openapi/spec.ts`: `app.doc('/api/openapi.json', ...)`
- [ ] `@hono/swagger-ui` на `/api/docs`
- [ ] `.openapi()` аннотации (description, example) на всех схемах
- [ ] `BearerAuth` security scheme + `security` на защищённых роутах

**Проверка фазы:**
- [ ] `/api/openapi.json` — валидная OpenAPI 3.0 спецификация
- [ ] `/api/docs` в браузере: все эндпоинты, замки на защищённых
- [ ] `npx tsc --noEmit` — 0 ошибок

## Фаза 7: Tests

- [ ] `vitest.config.ts`: `environment: 'node'`, `globalSetup`
- [ ] `tests/helpers/db.ts`: `DATABASE_URL_TEST`, программный `migrate()` из `drizzle-orm/node-postgres/migrator`, test-seed 5–10 тайтлов (включая 1–2 сериала с кастом), `truncateAll()` (users/favorites) в `beforeEach`
- [ ] `tests/helpers/request.ts`: обёртка над `app.request()`
- [ ] `tests/auth.test.ts`: unit password/jwt + integration register/login/me/дубликат
- [ ] `tests/titles.test.ts`: поиск, фильтры (`type`/`year`/`genre`), пагинация, детальная (cast, поля сериала), 404, clamp
- [ ] `tests/genres.test.ts`: happy-path
- [ ] `tests/favorites.test.ts`: add/409/list/delete/401/isFavorite

**Проверка фазы:**
- [ ] `pnpm test` — зелёные
- [ ] `pnpm test --coverage` — роуты >= 70%
- [ ] Тесты не зависят от порядка запуска

## Фаза 8: Polish

- [ ] CORS middleware (`hono/cors`)
- [ ] Request logging middleware (метод, путь, статус, время)
- [ ] Rate limiting на auth: рукописный in-memory sliding window Map → 429
- [ ] Edge cases: `page < 1` → 400; `limit > 100` → clamp; пустой `q` → игнор фильтра; невалидный `type` → 400
- [ ] README: запуск (compose, migrate, seed, dev, test)
- [ ] Финальная проверка `.env.example`, `.gitignore`

**Проверка фазы:**
- [ ] Burst register → 429
- [ ] `?page=0` → 400; `?limit=999` → <= 100; `?type=cartoon` → 400
- [ ] Финальные `npx tsc --noEmit` + `pnpm test` — зелёные
