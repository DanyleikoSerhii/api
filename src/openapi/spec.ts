import { swaggerUI } from '@hono/swagger-ui';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getSystemUserToken } from '../lib/systemUser.js';
import { setAuthCookie, AUTH_COOKIE } from '../lib/cookies.js';
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
    ],
  });

  // Dynamic handler: mint a fresh system-user token per request and drop it into
  // the auth cookie for this origin. Because the docs are served by the API
  // itself, "Try it out" requests are same-origin and send the cookie by default
  // — no `withCredentials` (which would force a credentialed CORS request and
  // fail whenever the docs origin isn't the configured ALLOWED_ORIGIN).
  // Per-request signing avoids a cookie that expires once the process has been
  // running longer than the JWT TTL.
  //
  // The auto-auth is best-effort: the docs are a static asset and must not 500
  // just because the DB is unreachable. If minting the token fails, serve the UI
  // without the cookie — the user can still authenticate manually.
  app.get('/api/docs', async (c) => {
    try {
      const token = await getSystemUserToken();
      setAuthCookie(c, token);
    } catch (err) {
      console.error('docs: failed to provision system-user auth cookie', err);
    }
    return swaggerUI({ url: '/api/openapi.json' })(c, async () => {});
  });
}
