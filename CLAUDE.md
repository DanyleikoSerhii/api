# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                 # dev server with hot reload (tsx watch src/index.ts)
pnpm build               # tsc -> dist/
pnpm check               # prettier --check . && eslint .  (run before committing)
pnpm fix                 # prettier --write . && eslint . --fix
pnpm test                # vitest run (all tests, against the test DB)
pnpm test:coverage       # vitest run --coverage

# Single test file / single test by name:
pnpm exec vitest run tests/auth.test.ts
pnpm exec vitest run -t "returns 401 for an expired token"

# Database (Drizzle):
pnpm db:generate         # generate a migration from schema changes
pnpm db:migrate          # apply migrations (src/db/migrate.ts -> drizzle/migrations)
pnpm db:seed             # seed from IMDb TSVs in seeds/ (src/seed/run.ts; see README for required files)
pnpm db:enrich           # backfill TMDB data (poster/backdrop/trailer); needs TMDB_ACCESS_TOKEN
```

`db:enrich` (`src/enrich/run.ts` + `src/lib/tmdb.ts`) is resumable — by default it only fills titles with a null `tmdbId`; pass `--force` to re-process everything. It's optional: the app and tests run without `TMDB_ACCESS_TOKEN`.

**Running tests requires Postgres up:** `docker compose up -d` (postgres on host port **5433**). The vitest global setup (`tests/helpers/db.ts`) auto-creates the `movie_explorer_test` database, enables `pg_trgm`, runs migrations, and seeds a small fixture — so you don't migrate/seed the test DB manually. Tests run with `fileParallelism: false` because they share one database.

On Windows where `docker` isn't on PATH, the Docker Desktop CLI lives at `C:\Program Files\Docker\Docker\resources\bin`.

## Architecture

Hono REST API (`@hono/zod-openapi`) over Drizzle ORM + node-postgres, deployed as a single Vercel function. The whole app is assembled by `createApp()` in `src/app.ts`; `api/index.ts` is the Vercel entry (wraps `createApp().fetch` via `getRequestListener`) and `src/index.ts` is the local Node server. Both call the same `createApp()`. Vercel's filesystem catch-all only matched one path segment, so `vercel.json` adds `rewrites: [{ source: '/api/:path*', destination: '/api' }]` to funnel every nested `/api/...` request into that single function (otherwise `/api/movies/{id}`, `/api/people/{id}`, etc. return Vercel's platform 404 before reaching Hono).

**Request pipeline (`src/app.ts`):** CORS (with `credentials: true`, origin from `ALLOWED_ORIGIN`) → 1 MB body-size guard → request logger → routes → OpenAPI docs → `onError` (returns the unified error envelope). `GET /health` pings the DB and returns 503 `{ status: 'degraded' }` when it's down.

**Routes (`src/routes/`)** — each is its own `OpenAPIHono` instance, mounted at `/` in `src/routes/index.ts` (`mountRoutes`):
- `auth.ts` — register / login / me (JWT)
- `movies.ts` — catalog list (search + filters + sort + pagination), detail (`/api/movies/{id}`), similar (`/api/movies/{id}/similar`). NOTE: the underlying table is still `titles` (movies **and** series); only the API surface is named `movies`.
- `genres.ts`, `favorites.ts` (auth-required), `people.ts` (`/api/people/{id}` + filmography)

**Data model (`src/db/schema.ts`):** one `titles` table with `type` = `'movie' | 'series'` (not separate tables). `genres`/`titleGenres` and `people`/`titleCast` are many-to-many join tables; `favorites` is `(userId, titleId)`. `rating` is `numeric(3,1)` — Postgres returns it as a **string**, so always wrap reads in `Number()`.

**OpenAPI:** every route is declared with `createRoute(...)` then registered via `router.openapi(route, handler)`. Tags live in `src/openapi/schemas.ts` (`Tags`), the doc/Swagger UI is wired in `src/openapi/spec.ts` (`GET /api/openapi.json`, `GET /api/docs`). Response/shared Zod schemas also live in `schemas.ts`.

**Auth is cookie-based, not header Bearer.** The JWT (`src/lib/jwt.ts`, HS256, 24h TTL via `hono/jwt`) is set as / read from an **HTTP-only `token` cookie** (`src/lib/cookies.ts`: `secure` + `SameSite=None` in prod, `Lax` in dev). Password hashing is bcrypt (`src/lib/password.ts`). `requireAuth` (`src/middleware/auth.ts`) rejects with 401 when the cookie is missing/invalid; `optionalAuth` (`src/middleware/optionalAuth.ts`, a **separate file**) populates `c.get('user')` as `user | null` (used by movie detail for `isFavorite`). Login runs a dummy bcrypt compare on unknown emails to equalize timing.

**Rate limiting:** `src/middleware/rateLimit.ts` — in-memory, per-IP (10 req / 60s), applied only to `/api/auth/register` and `/api/auth/login`. It keys on the raw socket address (not `x-forwarded-for`, which is spoofable). Call `resetRateLimitStore()` between tests. Note this is per-instance, so it doesn't hold across Vercel's serverless instances.

**System user:** `src/lib/systemUser.ts` provisions a passwordless `system@movie-explorer.local` account (login-impossible — unusable hash, reachable only via a minted JWT). Used to own enrichment-sourced data.

**Shared list query:** `src/lib/listQuery.ts` holds `buildPagination` and `titleSearchCondition` (OR of title / director / actor-name ILIKE), reused by both the movies list and the favorites list.

## Conventions & gotchas

- **ESM + `verbatimModuleSyntax`:** all relative imports end in `.js` (even for `.ts` files). Type-only imports must use `import { type X }` / `import type` or `tsc` fails (e.g. `type AnyColumn` from `drizzle-orm`).
- **Error envelope:** never hand-roll error JSON. Use `errorResponse(c, ErrorCode.X, message, details?)` from `src/lib/errors.ts` — it maps each `ErrorCode` to its status via `statusMap` and emits `{ error: { code, message, details? } }`. Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500); keep the OpenAPI enum in `schemas.ts` in sync. Every `OpenAPIHono` is constructed with `{ defaultHook }` so Zod failures return the same shape (400 `VALIDATION_ERROR`). In `src/app.ts`, `app.notFound` returns the envelope (`NOT_FOUND`) for unmatched routes, and `app.onError` surfaces a thrown `AppError` as its envelope but collapses any other error to a generic 500 (logged server-side, never leaking the message/cause to the client).
- **Static-before-param route registration:** when a static path collides with a param route (e.g. `/api/favorites/check` vs `/api/favorites/{titleId}`), register the static route's `.openapi(...)` **first** so the literal segment isn't swallowed by the `{id}` param (which would coerce to `NaN` → 400). Same applies to any new `/api/movies/<word>` route vs `/api/movies/{id}`.
- **`pg_trgm` is not in the migration.** The `gin_trgm_ops` index on `titles.title` needs the `pg_trgm` extension, but `CREATE EXTENSION` was removed from the migration for Nile/Vercel-Postgres compatibility. It's enabled instead by the test global setup and by `docker/init-test-db.sql` for local Postgres. If you add a fresh environment, ensure the extension exists.
- **DB connection string:** `src/env.ts` validates env with Zod and accepts `POSTGRES_URL` as a fallback for `DATABASE_URL` (Nile/Vercel expose the former). `JWT_SECRET` must be ≥32 chars. Tests use `DATABASE_URL_TEST` (optional in non-test runs); `TMDB_ACCESS_TOKEN` is optional and only needed for `db:enrich`.
- **LIKE searches** must escape user input via `escapeLikePattern` (`src/lib/sql.ts`) and use `ILIKE ... ESCAPE '\\'`. Sortable columns are always a fixed whitelist (Zod enum), never a raw client-supplied column name.
- **Lint scope:** `eslint .` type-checks against `tsconfig.eslint.json` (separate from `tsconfig.json`); new top-level dirs with `.ts` files must be added to its `include` or eslint errors with a parser project error.
- ESLint enforces `type` over `interface` (`consistent-type-definitions`) and bans `any`.
