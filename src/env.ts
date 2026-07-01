import { config } from 'dotenv';
import { z } from 'zod';

config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
  ALLOWED_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  // Only required to run `pnpm db:enrich`; the app and tests run without it.
  TMDB_ACCESS_TOKEN: z.string().optional(),
  // Optional: Telegram bot integration. When set, POST /api/notifications/telegram/test works.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

// Nile / Vercel Postgres expose the connection string as POSTGRES_URL.
// Accept it as a fallback so the same code works locally and in deployment.
const parsed = schema.safeParse({
  ...process.env,
  DATABASE_URL: process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'],
});

if (!parsed.success) {
  // Surface a readable reason in the logs. Otherwise a missing env var throws a
  // raw ZodError at import time, which on serverless (Vercel) shows up only as
  // an opaque FUNCTION_INVOCATION_FAILED with no usable log line.
  const reason = parsed.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  console.error(`env: invalid environment configuration — ${reason}`);
  throw new Error(`Invalid environment configuration: ${reason}`);
}

export const env = parsed.data;
