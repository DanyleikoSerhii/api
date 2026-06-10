import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config();

const testDbUrl =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres:postgres@localhost:5433/movie_explorer_test';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/helpers/db.ts',
    setupFiles: ['./tests/helpers/setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: testDbUrl,
      DATABASE_URL_TEST: testDbUrl,
    },
  },
});
