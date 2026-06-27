import { swaggerUI } from '@hono/swagger-ui';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { AUTH_COOKIE } from '../lib/cookies.js';
import { Tags } from './schemas.js';

export function mountOpenAPI(app: OpenAPIHono) {
  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: AUTH_COOKIE,
    description:
      'HS256 JWT (TTL 24 h) in an httpOnly cookie, set by `POST /api/auth/register` or `POST /api/auth/login`.',
  });

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Movie Explorer API',
      version: '1.0.0',
    },
    // Relative URL: Swagger UI targets whatever origin serves the docs, so
    // "Try it out" stays same-origin in dev (any host/port) and in production.
    servers: [{ url: '/' }],
    tags: [
      {
        name: Tags.AUTH,
        description:
          'Registration, login, current-user profile, and password management. Tokens use HS256 JWT with a 24-hour TTL.',
      },
      {
        name: Tags.MOVIES,
        description:
          'Catalog of movies and TV series. Search, filter, sort, paginate, browse popular titles, and get typeahead suggestions.',
      },
      {
        name: Tags.GENRES,
        description: 'Available genres for use as catalog filter values.',
      },
      {
        name: Tags.FAVORITES,
        description:
          "Manage the authenticated user's personal list of favorited titles. Supports search, sort, and bulk status lookup.",
      },
      {
        name: Tags.PEOPLE,
        description: 'Cast members and directors with their filmography.',
      },
      {
        name: Tags.NOTIFICATIONS,
        description: 'Developer utilities for testing notification integrations.',
      },
    ],
  });

  // Serve the Swagger UI as a static asset — no DB access. "Try it out" stays
  // same-origin (cookie auth works once you log in via POST /api/auth/login).
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json', deepLinking: true }));
}
