import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

// Managed Postgres (Nile, Vercel Postgres) requires TLS. Enable it for any
// non-local host without pinning a CA chain, so the connection succeeds
// regardless of the URL's sslmode — notably `sslmode=require`, which newer pg
// treats as `verify-full` and would otherwise reject a cert that isn't in the
// runtime trust store. Plain local Postgres (tests / docker) has no TLS.
const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(env.DATABASE_URL);
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export { pool };
