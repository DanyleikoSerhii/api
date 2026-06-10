import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, desc, count, inArray, exists, sql, SQL } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { titles, titleGenres, genres, titleCast, people, favorites } from '../db/schema.js';
import { errorResponse, ErrorCode, defaultHook } from '../lib/errors.js';
import { escapeLikePattern } from '../lib/sql.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import {
  Tags,
  titleListSchema,
  titleDetailSchema,
  errorResponseSchema,
} from '../openapi/schemas.js';

const jsonError = { content: { 'application/json': { schema: errorResponseSchema } } };

const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

const titlesQuerySchema = z.object({
  q: z
    .string()
    .max(100)
    .optional()
    .openapi({ description: 'Search by title (ILIKE %q%). Max 100 chars.', example: 'matrix' }),
  type: z.enum(['movie', 'series']).optional().openapi({ description: 'Filter by title type.' }),
  year: z.coerce
    .number()
    .int()
    .min(1800)
    .max(2200)
    .optional()
    .openapi({ description: 'Filter by start year.', example: 1994 }),
  genre: z
    .string()
    .max(100)
    .optional()
    .openapi({ description: 'Filter by genre name (case-insensitive).', example: 'Drama' }),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1).openapi({ example: 1 }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(20)
    .openapi({ example: 20, description: `Max ${MAX_LIMIT}.` }),
});

const listRoute = createRoute({
  method: 'get',
  path: '/api/titles',
  tags: [Tags.TITLES],
  summary: 'List titles',
  description:
    'Paginated catalog of movies and series. Supports text search (ILIKE) and combinable filters by type, year, and genre. Sorted by IMDb rating descending.',
  request: { query: titlesQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: titleListSchema } },
      description: 'List of titles',
    },
    400: { ...jsonError, description: 'Validation error' },
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/api/titles/{id}',
  tags: [Tags.TITLES],
  summary: 'Get a title by id',
  description:
    "Returns full details including up to 10 cast members. For series, includes `seasonsCount`, `episodesCount`, and `endYear` (null for ongoing). When called with a valid Bearer token, `isFavorite` reflects the caller's state; without a token it is always `false`.",
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.coerce.number().int().positive().openapi({ example: 889 }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: titleDetailSchema } },
      description: 'Title detail',
    },
    404: { ...jsonError, description: 'Title not found' },
  },
});

type OptionalAuthVariables = {
  user: { sub: number; email: string } | null;
};

export const titlesRouter = new OpenAPIHono<{ Variables: OptionalAuthVariables }>({ defaultHook });

titlesRouter.use('/api/titles/:id', optionalAuth);

titlesRouter.openapi(listRoute, async (c) => {
  const { q, type, year, genre, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];

  if (q && q.trim() !== '') {
    conditions.push(sql`${titles.title} ILIKE ${`%${escapeLikePattern(q)}%`} ESCAPE '\\'`);
  }
  if (type) {
    conditions.push(eq(titles.type, type));
  }
  if (year) {
    conditions.push(eq(titles.year, year));
  }

  if (genre) {
    const escaped = escapeLikePattern(genre);
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(titleGenres)
          .innerJoin(genres, eq(titleGenres.genreId, genres.id))
          .where(
            and(
              eq(titleGenres.titleId, titles.id),
              sql`${genres.name} ILIKE ${escaped} ESCAPE '\\'`,
            ),
          ),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRows = await db.select({ value: count() }).from(titles).where(whereClause);
  const total = totalRows[0]?.value ?? 0;

  const rows = await db
    .select()
    .from(titles)
    .where(whereClause)
    .orderBy(desc(titles.rating))
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
    posterUrl: t.posterUrl ?? null,
    genres: genreMap.get(t.id) ?? [],
  }));

  return c.json(
    {
      data,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    },
    200,
  );
});

titlesRouter.openapi(detailRoute, async (c) => {
  const { id } = c.req.valid('param');

  const [title] = await db.select().from(titles).where(eq(titles.id, id)).limit(1);
  if (!title) {
    return errorResponse(c, ErrorCode.NOT_FOUND, 'Title not found') as never;
  }

  const titleGenreRows = await db
    .select({ name: genres.name })
    .from(titleGenres)
    .innerJoin(genres, eq(titleGenres.genreId, genres.id))
    .where(eq(titleGenres.titleId, id));

  const castRows = await db
    .select({
      personId: people.id,
      name: people.name,
      character: titleCast.character,
      ord: titleCast.ord,
    })
    .from(titleCast)
    .innerJoin(people, eq(titleCast.personId, people.id))
    .where(eq(titleCast.titleId, id))
    .orderBy(titleCast.ord)
    .limit(10);

  const user = c.get('user');
  let isFavorite = false;
  if (user) {
    const fav = await db
      .select({ titleId: favorites.titleId })
      .from(favorites)
      .where(and(eq(favorites.userId, user.sub), eq(favorites.titleId, id)))
      .limit(1);
    isFavorite = fav.length > 0;
  }

  return c.json(
    {
      id: title.id,
      type: title.type === 'movie' ? ('movie' as const) : ('series' as const),
      title: title.title,
      year: title.year,
      endYear: title.endYear ?? null,
      director: title.director ?? null,
      description: title.description ?? null,
      rating: Number(title.rating),
      posterUrl: title.posterUrl ?? null,
      genres: titleGenreRows.map((g) => g.name),
      seasonsCount: title.seasonsCount ?? null,
      episodesCount: title.episodesCount ?? null,
      cast: castRows.map((r) => ({ id: r.personId, name: r.name, character: r.character ?? null })),
      isFavorite,
    },
    200,
  );
});
