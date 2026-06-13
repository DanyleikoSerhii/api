import { swaggerUI } from '@hono/swagger-ui';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { env } from '../env.js';
import { Tags } from './schemas.js';

export function mountOpenAPI(app: OpenAPIHono) {
  app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'HS256 JWT (TTL 24 h). Obtain via `POST /api/auth/register` or `POST /api/auth/login`, then click **Authorize** above.',
  });

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Movie Explorer API',
      version: '1.0.0',
      description: [
        'REST API for browsing movies and TV series with personal favorites and profile management.',
        '',
        '## Data',
        'Seeded from [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/) — ~1 700 titles with rating ≥ 7.5 and ≥ 50 000 votes.',
        'Selected titles are enriched with trailers, posters, and backdrops from TMDB.',
        '',
        '## Auth',
        'JWT Bearer (HS256, 24 h TTL). Register or log in to receive a token, then use **Authorize** above.',
        '',
        '## Errors',
        'Every non-2xx response uses the unified `ErrorResponse` envelope:',
        '```json',
        '{ "error": { "code": "NOT_FOUND", "message": "Title not found" } }',
        '```',
        'Possible `code` values: `VALIDATION_ERROR` · `UNAUTHORIZED` · `NOT_FOUND` · `CONFLICT` · `INTERNAL_ERROR`.',
        '',
        '## Rate limiting',
        'Auth endpoints (`/register`, `/login`) are limited to **10 requests / minute per IP**.',
      ].join('\n'),
      contact: { name: 'Serhii Danyleiko', email: 'sergeydanyleuko@gmail.com' },
      license: { name: 'Educational use only' },
    },
    externalDocs: {
      description: 'IMDb Non-Commercial Datasets',
      url: 'https://developer.imdb.com/non-commercial-datasets/',
    },
    servers: [{ url: `http://localhost:${env.PORT}`, description: 'Local development' }],
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
    ],
  });

  app.get(
    '/api/docs',
    swaggerUI({
      url: '/api/openapi.json',
      persistAuthorization: true,
    }),
  );
}
