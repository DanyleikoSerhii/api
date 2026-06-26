DO $$
BEGIN
	-- Idempotent convergence step for environments where the original migration
	-- ran before pg_trgm was available (e.g. a managed prod DB), which left
	-- "titles_title_gin_idx" missing. Re-enable the extension best-effort and
	-- (re)create the trigram index when the opclass exists. Safe to run anywhere.
	BEGIN
		CREATE EXTENSION IF NOT EXISTS pg_trgm;
	EXCEPTION WHEN OTHERS THEN
		RAISE NOTICE 'pg_trgm not enabled (%); skipping trigram index', SQLERRM;
	END;

	IF EXISTS (SELECT 1 FROM pg_opclass WHERE opcname = 'gin_trgm_ops') THEN
		CREATE INDEX IF NOT EXISTS "titles_title_gin_idx" ON "titles" USING gin ("title" gin_trgm_ops);
	END IF;
END
$$;
