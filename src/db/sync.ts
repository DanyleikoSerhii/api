import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

// Standalone schema-convergence runner for the managed prod DB. Unlike the
// journaled migrator (src/db/migrate.ts), this does NOT need the "drizzle"
// schema or a migrations journal — it applies idempotent, additive DDL from
// drizzle/prod-sync.sql, which only needs ALTER/CREATE on existing objects.
// See drizzle/prod-sync.sql for why Nile's role can't run the journaled migrator.
//
// Each statement runs on its own (NOT as one multi-statement query): node-postgres
// sends a multi-statement string as a single implicit transaction, so one failure
// rolls back ALL of it. Nile rejects some DDL (no `DO` blocks, no `CREATE
// EXTENSION`, no functional index expressions) — running per-statement lets those
// fail-and-skip while the essential ALTER ... ADD COLUMN statements still apply.
const connectionString = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];

if (!connectionString) {
  console.error('sync: neither DATABASE_URL nor POSTGRES_URL is set — cannot converge schema.');
  process.exit(1);
}

// Mirror migrate.ts: managed Postgres (Nile/Vercel) requires TLS; plain local
// Postgres (docker/tests) has none, so skip it there.
const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

// Columns the API SELECTs on every /api/movies query. Convergence is only a
// success if these exist; optional pieces (trigram index, functional nickname
// index) may legitimately be skipped on Nile.
const REQUIRED_TITLES_COLUMNS = ['backdrop_url', 'tmdb_id', 'trailer_key'];

// Split the .sql file into individual statements. Statements never embed a `;`
// (no `DO $$ ... $$` blocks — see the note in prod-sync.sql), so a naive split
// after stripping `--` comments is safe.
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const rawSql = readFileSync(new URL('../../drizzle/prod-sync.sql', import.meta.url), 'utf8');
const statements = splitStatements(rawSql);
const maskedTarget = connectionString.replace(/\/\/[^@]*@/, '//***@');

try {
  console.log(`sync: connecting to ${maskedTarget}${isLocal ? ' (no TLS)' : ' (TLS)'}`);
  console.log(`sync: applying ${statements.length} statement(s)`);

  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
    try {
      await pool.query(stmt);
      console.log(`  OK   ${label}`);
    } catch (err) {
      // Don't abort: a statement unsupported on this engine (Nile) must not
      // block the others. The final column check decides overall success.
      console.log(`  SKIP ${label} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'titles' AND column_name = ANY($1)`,
    [REQUIRED_TITLES_COLUMNS],
  );
  const present = new Set(rows.map((r) => r.column_name));
  const missing = REQUIRED_TITLES_COLUMNS.filter((c) => !present.has(c));

  if (missing.length > 0) {
    console.error(`sync: FAILED — required titles columns still missing: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('sync: schema converged (required titles columns present)');
  }
} catch (err) {
  console.error('sync: failed —', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
