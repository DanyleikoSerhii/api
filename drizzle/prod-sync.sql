-- Idempotent convergence of the prod schema to src/db/schema.ts.
--
-- The journaled Drizzle migrator can't run against the managed prod DB (Nile):
-- the role lacks CREATE SCHEMA, so it can't create the "drizzle" bookkeeping
-- schema, and prod was bootstrapped without that journal — so a fresh run would
-- also try to replay 0000 (CREATE TABLE ...) over already-existing tables.
--
-- Instead we converge with guarded, additive DDL that needs only ALTER/CREATE on
-- existing objects. It is safe to run repeatedly and mirrors migrations 0001-0003.
-- Base tables (0000) are assumed to already exist on prod.
--
-- IMPORTANT: src/db/sync.ts runs each statement below SEPARATELY (split on `;`),
-- so one statement failing does NOT roll back the others. That matters on Nile,
-- which rejects some DDL (no `DO` blocks, no `CREATE EXTENSION`, no functional
-- index expressions). Those statements are expected to fail-and-skip on Nile but
-- still apply on a stock Postgres. Therefore: keep every statement on as few
-- lines as possible and NEVER embed a `;` inside one (no `DO $$ ... $$` blocks),
-- or the naive split will mangle it.

-- 0001: users profile columns + case-insensitive nickname uniqueness.
-- (The functional index is skipped on Nile: "functions are not supported in
-- index column expression".)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "nickname" varchar(50);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "first_name" varchar(100);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_name" varchar(100);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_nickname_lower_idx" ON "users" (lower("nickname"));

-- 0002: TMDB enrichment columns on titles. The missing backdrop_url was the
-- cause of the prod 42703 "column does not exist" errors on /api/movies.
ALTER TABLE "titles" ADD COLUMN IF NOT EXISTS "backdrop_url" varchar(1000);
ALTER TABLE "titles" ADD COLUMN IF NOT EXISTS "tmdb_id" integer;
ALTER TABLE "titles" ADD COLUMN IF NOT EXISTS "trailer_key" varchar(20);

-- 0003: trigram index for title search. Best-effort: both statements are skipped
-- on Nile ("command tag CREATE EXTENSION unhandled"); on a stock Postgres they
-- enable the gin_trgm_ops index that speeds up ILIKE search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "titles_title_gin_idx" ON "titles" USING gin ("title" gin_trgm_ops);
