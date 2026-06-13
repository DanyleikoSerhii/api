import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { env } from '../env.js';

const pool = new Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: './drizzle/migrations' });
console.log('Migrations complete');
await pool.end();
