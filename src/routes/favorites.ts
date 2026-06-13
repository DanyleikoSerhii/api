import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, asc, desc, count, inArray, SQL, type AnyColumn } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { favorites, titles, titleGenres, genres } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { errorResponse, ErrorCode, defaultHook } from '../lib/errors.js';
import { buildPagination, titleSearchCondition } from '../lib/listQuery.js';
import {
  Tags,
  titleListSchema,
  addFavoriteResponseSchema,
  errorResponseSchema,
} from '../openapi/schemas.js';

type AuthVariables = {
  user: { sub: number; email: string };
};

const jsonError = { content: { 'application/json': { schema: errorResponseSchema } } };

const favoritesQuerySchema = z.object({
  q: z
    .string()
    .max(100)
    .optional()
    .openapi({ description: 'Search by title, director, or actor.', example: 'Cranston' }),
  sort: z
    .enum(['rating', 'year', 'numVotes', 'title', 'addedAt'])
    .default('addedAt')
    .openapi({ description: 'Sort column.' }),
  order: z.enum(['asc', 'desc']).default('desc').openapi({ description: 'Sort direction.' }),
  page: z.coerce.number().int().min(1).max(10_000).default(1).openapi({ example: 1 }),
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
});

type FavSortKey = 'rating' | 'year' | 'numVotes' | 'title' | 'addedAt';

const favSortColumns: Record<FavSortKey, AnyColumn> = {
  rating: titles.rating,
  year: titles.year,
  numVotes: titles.numVotes,
  title: titles.title,
  addedAt: favorites.addedAt,
};

const titleIdParamSchema = z.object({
  titleId: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ example: 889, description: 'Movie id from /api/movies.' }),
});

const bulkCheckBodySchema = z.object({
  titleIds: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(100)
    .openapi({ example: [889, 1234] }),
});

const bulkCheckResponseSchema = z.object({
  data: z.array(
    z.object({
      titleId: z.number().int().positive().openapi({ example: 889 }),
      isFavorite: z.boolean().openapi({ example: true }),
    }),
  ),
});

const listRoute = createRoute({
  method: 'get',
  path: '/api/favorites',
  tags: [Tags.FAVORITES],
  summary: "List the user's favorites",
  description:
    'Paginated list of favorited titles. Supports text search (`q` matches title, director, actor) and sorting by rating, year, numVotes, title, or addedAt (default addedAt desc).',
  security: [{ BearerAuth: [] }],
  request: { query: favoritesQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: titleListSchema } },
      description: 'Favorites list',
    },
    401: { ...jsonError, description: 'Missing or invalid token' },
  },
});

const checkRoute = createRoute({
  method: 'post',
  path: '/api/favorites/check',
  tags: [Tags.FAVORITES],
  summary: 'Bulk favorite-status lookup',
  description:
    'Given a list of title ids, returns the favorite status for the authenticated user. One entry per requested id (deduped).',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: bulkCheckBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: bulkCheckResponseSchema } },
      description: 'Favorite-status map',
    },
    400: { ...jsonError, description: 'Validation error' },
    401: { ...jsonError, description: 'Missing or invalid token' },
  },
});

const addRoute = createRoute({
  method: 'post',
  path: '/api/favorites/{titleId}',
  tags: [Tags.FAVORITES],
  summary: 'Add a title to favorites',
  description:
    'Idempotency note: returns 409 if the pair already exists rather than silently re-inserting.',
  security: [{ BearerAuth: [] }],
  request: { params: titleIdParamSchema },
  responses: {
    201: {
      content: { 'application/json': { schema: addFavoriteResponseSchema } },
      description: 'Added to favorites',
    },
    401: { ...jsonError, description: 'Missing or invalid token' },
    404: { ...jsonError, description: 'Title not found' },
    409: { ...jsonError, description: 'Already in favorites' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/api/favorites/{titleId}',
  tags: [Tags.FAVORITES],
  summary: 'Remove a title from favorites',
  description:
    '404 means the (user, title) pair is not in favorites. Title existence is not re-checked separately.',
  security: [{ BearerAuth: [] }],
  request: { params: titleIdParamSchema },
  responses: {
    204: { description: 'Removed (no content)' },
    401: { ...jsonError, description: 'Missing or invalid token' },
    404: { ...jsonError, description: 'Not in favorites' },
  },
});

export const favoritesRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook });

favoritesRouter.use('/api/favorites', requireAuth);
favoritesRouter.use('/api/favorites/*', requireAuth);

favoritesRouter.openapi(listRoute, async (c) => {
  const user = c.get('user');
  const { q, sort, order, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];
  if (q && q.trim() !== '') {
    conditions.push(titleSearchCondition(q));
  }

  const whereClause = and(eq(favorites.userId, user.sub), ...conditions);

  const totalRows = await db
    .select({ value: count() })
    .from(favorites)
    .innerJoin(titles, eq(favorites.titleId, titles.id))
    .where(whereClause);
  const total = totalRows[0]?.value ?? 0;

  if (total === 0) {
    return c.json({ data: [], pagination: buildPagination(page, limit, 0) }, 200);
  }

  const sortDir = order === 'asc' ? asc : desc;
  const rows = await db
    .select({
      id: titles.id,
      type: titles.type,
      title: titles.title,
      year: titles.year,
      director: titles.director,
      rating: titles.rating,
      numVotes: titles.numVotes,
      posterUrl: titles.posterUrl,
    })
    .from(favorites)
    .innerJoin(titles, eq(favorites.titleId, titles.id))
    .where(whereClause)
    .orderBy(sortDir(favSortColumns[sort]), desc(favorites.addedAt))
    .limit(limit)
    .offset(offset);

  const pageIds = rows.map((r) => r.id);
  const genreRows =
    pageIds.length > 0
      ? await db
          .select({ titleId: titleGenres.titleId, name: genres.name })
          .from(titleGenres)
          .innerJoin(genres, eq(titleGenres.genreId, genres.id))
          .where(inArray(titleGenres.titleId, pageIds))
      : [];

  const genreMap = new Map<number, string[]>();
  for (const g of genreRows) {
    const arr = genreMap.get(g.titleId) ?? [];
    arr.push(g.name);
    genreMap.set(g.titleId, arr);
  }

  const data = rows.map((t) => ({
    id: t.id,
    type: t.type === 'movie' ? ('movie' as const) : ('series' as const),
    title: t.title,
    year: t.year,
    director: t.director ?? null,
    rating: Number(t.rating),
    numVotes: t.numVotes,
    posterUrl: t.posterUrl ?? null,
    genres: genreMap.get(t.id) ?? [],
  }));

  return c.json({ data, pagination: buildPagination(page, limit, Number(total)) }, 200);
});

favoritesRouter.openapi(checkRoute, async (c) => {
  const user = c.get('user');
  const { titleIds } = c.req.valid('json');

  const uniqueIds = [...new Set(titleIds)];

  const rows = await db
    .select({ titleId: favorites.titleId })
    .from(favorites)
    .where(and(eq(favorites.userId, user.sub), inArray(favorites.titleId, uniqueIds)));

  const favoritedIds = new Set(rows.map((r) => r.titleId));

  const data = uniqueIds.map((titleId) => ({
    titleId,
    isFavorite: favoritedIds.has(titleId),
  }));

  return c.json({ data }, 200);
});

favoritesRouter.openapi(addRoute, async (c) => {
  const user = c.get('user');
  const { titleId } = c.req.valid('param');

  const title = await db
    .select({ id: titles.id })
    .from(titles)
    .where(eq(titles.id, titleId))
    .limit(1);
  if (title.length === 0) {
    return errorResponse(c, ErrorCode.NOT_FOUND, 'Title not found') as never;
  }

  // ON CONFLICT DO NOTHING + check `returning` — handles the race where two
  // concurrent inserts would otherwise hit the unique PK constraint with a 500.
  const [fav] = await db
    .insert(favorites)
    .values({ userId: user.sub, titleId })
    .onConflictDoNothing()
    .returning({ titleId: favorites.titleId, addedAt: favorites.addedAt });

  if (!fav) {
    return errorResponse(c, ErrorCode.CONFLICT, 'Already in favorites') as never;
  }

  return c.json({ titleId: fav.titleId, addedAt: (fav.addedAt ?? new Date()).toISOString() }, 201);
});

favoritesRouter.openapi(deleteRoute, async (c) => {
  const user = c.get('user');
  const { titleId } = c.req.valid('param');

  const deleted = await db
    .delete(favorites)
    .where(and(eq(favorites.userId, user.sub), eq(favorites.titleId, titleId)))
    .returning({ titleId: favorites.titleId });

  if (deleted.length === 0) {
    return errorResponse(c, ErrorCode.NOT_FOUND, 'Favorite not found');
  }

  return new Response(null, { status: 204 });
});
