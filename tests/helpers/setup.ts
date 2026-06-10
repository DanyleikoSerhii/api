import { config } from 'dotenv';

config();

const testUrl =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres:postgres@localhost:5433/movie_explorer_test';

process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_TEST = testUrl;
