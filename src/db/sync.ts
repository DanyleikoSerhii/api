import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

// Standalone schema-convergence runner for the managed prod DB. Unlike the
// journaled migrator (src/db/migrate.ts), this does NOT need the "drizzle"
// schema or a migrations journal — it just applies idempotent, guarded DDL from
// drizzle/prod-sync.sql, which only needs ALTER/CREATE on existing objects.
// See drizzle/prod-sync.sql for why Nile's role can't run the journaled migrator.
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

const sql = readFileSync(new URL('../../drizzle/prod-sync.sql', import.meta.url), 'utf8');
const maskedTarget = connectionString.replace(/\/\/[^@]*@/, '//***@');

try {
  console.log(`sync: connecting to ${maskedTarget}${isLocal ? ' (no TLS)' : ' (TLS)'}`);
  await pool.query(sql);
  console.log('sync: schema converged');
} catch (err) {
  console.error('sync: failed —', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
