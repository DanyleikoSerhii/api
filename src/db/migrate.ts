import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Standalone migrator: deliberately does NOT import ../env.js. Migrations only
// need a connection string; pulling in env.ts would also require JWT_SECRET
// (and others) to be present wherever this runs (e.g. the Vercel build), which
// has nothing to do with applying migrations.
const connectionString = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];

if (!connectionString) {
  console.error(
    'migrate: neither DATABASE_URL nor POSTGRES_URL is set — cannot run migrations.',
  );
  process.exit(1);
}

// Managed Postgres (Nile, Vercel Postgres, etc.) requires TLS. Enable it for
// any non-local host without pinning a CA chain, so we connect regardless of
// whether the connection string carries an explicit sslmode. Plain local
// Postgres (tests / docker) has no TLS, so skip it there.
const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

const maskedTarget = connectionString.replace(/\/\/[^@]*@/, '//***@');

try {
  console.log(`migrate: connecting to ${maskedTarget}${isLocal ? ' (no TLS)' : ' (TLS)'}`);
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
  console.log('migrate: complete');
} catch (err) {
  console.error('migrate: failed —', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
