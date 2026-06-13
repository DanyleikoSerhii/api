import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { asc, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { genres } from '../db/schema.js';
import { defaultHook } from '../lib/errors.js';
import { escapeLikePattern } from '../lib/sql.js';
import { Tags, genresResponseSchema } from '../openapi/schemas.js';

const listRoute = createRoute({
  method: 'get',
  path: '/api/genres',
  tags: [Tags.GENRES],
  summary: 'List all genres',
  description: 'Returns genres present in the catalog, sorted alphabetically. Use `q` to filter by name.',
  request: {
    query: z.object({
      q: z
        .string()
        .max(100)
        .optional()
        .openapi({ description: 'Filter genres by name substring (case-insensitive).', example: 'dra' }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: genresResponseSchema } },
      description: 'Genres list',
    },
    400: { description: 'Validation error' },
  },
});

export const genresRouter = new OpenAPIHono({ defaultHook });

genresRouter.openapi(listRoute, async (c) => {
  const { q } = c.req.valid('query');

  const whereClause =
    q && q.trim() !== ''
      ? sql`${genres.name} ILIKE ${`%${escapeLikePattern(q)}%`} ESCAPE '\\'`
      : undefined;

  const rows = await db
    .select({ name: genres.name })
    .from(genres)
    .where(whereClause)
    .orderBy(asc(genres.name));

  return c.json({ data: rows.map((r) => r.name) }, 200);
});
