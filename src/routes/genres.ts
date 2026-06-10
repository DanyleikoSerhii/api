import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { asc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { genres } from '../db/schema.js';
import { defaultHook } from '../lib/errors.js';
import { Tags, genresResponseSchema } from '../openapi/schemas.js';

const listRoute = createRoute({
  method: 'get',
  path: '/api/genres',
  tags: [Tags.GENRES],
  summary: 'List all genres',
  description: 'Returns every genre present in the catalog, sorted alphabetically.',
  responses: {
    200: {
      content: { 'application/json': { schema: genresResponseSchema } },
      description: 'All genres',
    },
  },
});

export const genresRouter = new OpenAPIHono({ defaultHook });

genresRouter.openapi(listRoute, async (c) => {
  const rows = await db.select({ name: genres.name }).from(genres).orderBy(asc(genres.name));
  return c.json({ data: rows.map((r) => r.name) }, 200);
});
