import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { mountRoutes } from './routes/index.js';
import { mountOpenAPI } from './openapi/spec.js';
import { ErrorCode, errorResponse } from './lib/errors.js';
import { env } from './env.js';

export function createApp() {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return errorResponse(
          c,
          ErrorCode.VALIDATION_ERROR,
          'Validation error',
          result.error.issues,
        );
      }
      return undefined;
    },
  });

  app.use('*', cors({ origin: env.ALLOWED_ORIGIN }));

  const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
  app.use('*', async (c, next) => {
    const len = c.req.header('content-length');
    if (len !== undefined && Number(len) > MAX_BODY_BYTES) {
      return c.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large.' } },
        413,
      );
    }
    return next();
  });

  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  mountRoutes(app);
  mountOpenAPI(app);

  app.onError((err, c) => {
    console.error(err);
    return errorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      err instanceof Error
        ? `${err.message} || CAUSE: ${err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : String(err.cause)}`
        : 'An unexpected error occurred',
    );
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
