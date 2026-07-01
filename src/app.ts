import { OpenAPIHono } from '@hono/zod-openapi';
import type { Env, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { mountRoutes } from './routes/index.js';
import { mountOpenAPI } from './openapi/spec.js';
import { AppError, ErrorCode, errorResponse, defaultHook } from './lib/errors.js';
import { pool } from './db/connection.js';
import { env } from './env.js';

export function createApp() {
  const app = new OpenAPIHono<Env>({ defaultHook });

  app.use('*', cors({ origin: env.ALLOWED_ORIGIN, credentials: true }));

  const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
  const bodySizeGuard: MiddlewareHandler = async (c, next) => {
    const len = c.req.header('content-length');
    if (len !== undefined && Number(len) > MAX_BODY_BYTES) {
      return errorResponse(c, ErrorCode.PAYLOAD_TOO_LARGE, 'Request body too large.');
    }
    return next();
  };
  app.use('*', bodySizeGuard);

  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
  });

  app.get('/health', async (c) => {
    try {
      await pool.query('SELECT 1');
      return c.json({ status: 'ok', db: 'up' });
    } catch {
      return c.json({ status: 'degraded', db: 'down' }, 503);
    }
  });

  mountRoutes(app);
  mountOpenAPI(app);

  // Unmatched routes get the same envelope as everything else, not Hono's
  // default plain-text "404 Not Found".
  app.notFound((c) => errorResponse(c, ErrorCode.NOT_FOUND, 'Route not found'));

  app.onError((err, c) => {
    // AppError carries a client-safe code/message/details — surface it as-is.
    if (err instanceof AppError) {
      return errorResponse(c, err.code, err.message, err.details);
    }
    // Anything else is unexpected: log the full error server-side, but never
    // leak its message/cause/stack to the client.
    console.error(err);
    return errorResponse(c, ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred');
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
