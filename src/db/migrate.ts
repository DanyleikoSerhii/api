import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { config } from 'dotenv';

config();

const pool = new Pool({ connectionString: process.env['DATABASE_URL']! });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: './drizzle/migrations' });
console.log('Migrations complete');
await pool.end();
