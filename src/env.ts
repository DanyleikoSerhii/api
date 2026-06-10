import { config } from 'dotenv';
import { z } from 'zod';

config();

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
  ALLOWED_ORIGIN: z.string().min(1).default('http://localhost:5173'),
});

export const env = schema.parse(process.env);
