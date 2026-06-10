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
      'JWT access token obtained from `POST /api/auth/login` or `POST /api/auth/register`.',
  });

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Movie API',
      version: '1.0.0',
      description: [
        'REST API for browsing movies and TV series with personal favorites.',
        '',
        '**Data source.** Seeded from official [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/) (~1700 titles, 7.5+ rating, 50k+ votes).',
        '',
        '**Auth.** JWT Bearer. Use `/api/auth/register` or `/api/auth/login` to obtain a token, then click the `Authorize` button above.',
        '',
        '**Errors.** All non-2xx responses share the `ErrorResponse` envelope: `{ error: { code, message, details? } }`.',
      ].join('\n'),
      license: { name: 'Educational use only' },
    },
    servers: [{ url: `http://localhost:${env.PORT}`, description: 'Local development' }],
    tags: [
      { name: Tags.AUTH, description: 'Registration, login, and current-user lookup.' },
      { name: Tags.TITLES, description: 'Browse and search movies and series.' },
      { name: Tags.GENRES, description: 'All available genres.' },
      { name: Tags.FAVORITES, description: "Manage the authenticated user's favorite titles." },
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
