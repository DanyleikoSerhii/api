import type { OpenAPIHono } from '@hono/zod-openapi';
import { authRouter } from './auth.js';
import { moviesRouter } from './movies.js';
import { genresRouter } from './genres.js';
import { favoritesRouter } from './favorites.js';
import { peopleRouter } from './people.js';

export function mountRoutes(app: OpenAPIHono) {
  app.route('/', authRouter);
  app.route('/', moviesRouter);
  app.route('/', genresRouter);
  app.route('/', favoritesRouter);
  app.route('/', peopleRouter);
}
