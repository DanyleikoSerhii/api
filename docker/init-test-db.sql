-- Runs automatically the first time the Postgres data volume is initialized
-- (scripts in /docker-entrypoint-initdb.d/ are executed by the postgres image).
-- The test suite (tests/helpers/db.ts) also creates the test DB + extension at
-- runtime as a fallback for already-initialized volumes, so the paths are
-- complementary.

-- 1. Create the dedicated test database alongside the dev database.
SELECT 'CREATE DATABASE movie_explorer_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'movie_explorer_test')\gexec

-- 2. Enable pg_trgm in both databases. It backs the gin_trgm_ops index in the
--    migration; CREATE EXTENSION was dropped from the migration itself for Nile
--    compatibility, so it has to be enabled here for local Postgres.
\connect movie_explorer
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\connect movie_explorer_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
