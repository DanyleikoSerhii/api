import { config } from 'dotenv';
import { z } from 'zod';

config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
  ALLOWED_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  // Only required to run `pnpm db:enrich`; the app and tests run without it.
  TMDB_ACCESS_TOKEN: z.string().optional(),
});

// Nile / Vercel Postgres expose the connection string as POSTGRES_URL.
// Accept it as a fallback so the same code works locally and in deployment.
export const env = schema.parse({
  ...process.env,
  DATABASE_URL: process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'],
});
