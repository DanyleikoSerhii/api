import type { OpenAPIHono } from '@hono/zod-openapi';
import { authRouter } from './auth.js';
import { titlesRouter } from './titles.js';
import { genresRouter } from './genres.js';
import { favoritesRouter } from './favorites.js';

export function mountRoutes(app: OpenAPIHono) {
  app.route('/', authRouter);
  app.route('/', titlesRouter);
  app.route('/', genresRouter);
  app.route('/', favoritesRouter);
}
