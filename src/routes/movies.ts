import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  eq,
  and,
  or,
  asc,
  desc,
  count,
  inArray,
  exists,
  sql,
  SQL,
  type AnyColumn,
} from 'drizzle-orm';
import { db } from '../db/connection.js';
import { titles, titleGenres, genres, titleCast, people, favorites } from '../db/schema.js';
import { errorResponse, ErrorCode, defaultHook } from '../lib/errors.js';
import { escapeLikePattern } from '../lib/sql.js';
import { buildPagination, titleSearchCondition } from '../lib/listQuery.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { trailerWatchUrl } from '../lib/tmdb.js';
import {
  Tags,
  titleListSchema,
  titleDetailSchema,
  similarTitlesSchema,
  errorResponseSchema,
} from '../openapi/schemas.js';

const jsonError = { content: { 'application/json': { schema: errorResponseSchema } } };

const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

const moviesQuerySchema = z.object({
  q: z
    .string()
    .max(100)
    .optional()
    .openapi({ description: 'Search by title, director, or actor (ILIKE %q%). Max 100 chars.', example: 'Cranston' }),
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
  genres: z.string().max(500).optional().openapi({
    description: 'Comma-separated genre names (case-insensitive), e.g. "Drama,Crime".',
    example: 'Drama,Crime',
  }),
  genreMode: z.enum(['any', 'all']).default('any').openapi({
    description: '`any` = matches at least one of `genres`; `all` = matches every listed genre.',
  }),
  yearFrom: z.coerce
    .number()
    .int()
    .min(1800)
    .max(2200)
    .optional()
    .openapi({ description: 'Filter by year >= yearFrom.', example: 1990 }),
  yearTo: z.coerce
    .number()
    .int()
    .min(1800)
    .max(2200)
    .optional()
    .openapi({ description: 'Filter by year <= yearTo.', example: 2010 }),
  minRating: z.coerce
    .number()
    .min(0)
    .max(10)
    .optional()
    .openapi({ description: 'Filter by rating >= minRating.', example: 9 }),
  minVotes: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .openapi({ description: 'Filter by numVotes >= minVotes.', example: 100000 }),
  sort: z
    .enum(['rating', 'year', 'numVotes', 'title', 'createdAt'])
    .default('rating')
    .openapi({ description: 'Sort column.' }),
  order: z.enum(['asc', 'desc']).default('desc').openapi({ description: 'Sort direction.' }),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1).openapi({ example: 1 }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(20)
    .openapi({ example: 20, description: `Max ${MAX_LIMIT}.` }),
});

const sortColumns: Record<'rating' | 'year' | 'numVotes' | 'title' | 'createdAt', AnyColumn> = {
  rating: titles.rating,
  year: titles.year,
  numVotes: titles.numVotes,
  title: titles.title,
  createdAt: titles.createdAt,
};

function genreExists(name: string): SQL {
  const escaped = escapeLikePattern(name);
  return exists(
    db
      .select({ one: sql`1` })
      .from(titleGenres)
      .innerJoin(genres, eq(titleGenres.genreId, genres.id))
      .where(
        and(eq(titleGenres.titleId, titles.id), sql`${genres.name} ILIKE ${escaped} ESCAPE '\\'`),
      ),
  );
}

// Builds the genre array for a page of title ids.
async function fetchGenreMap(pageIds: number[]): Promise<Map<number, string[]>> {
  if (pageIds.length === 0) return new Map();
  const rows = await db
    .select({ titleId: titleGenres.titleId, name: genres.name })
    .from(titleGenres)
    .innerJoin(genres, eq(titleGenres.genreId, genres.id))
    .where(inArray(titleGenres.titleId, pageIds));
  const map = new Map<number, string[]>();
  for (const g of rows) {
    const arr = map.get(g.titleId) ?? [];
    arr.push(g.name);
    map.set(g.titleId, arr);
  }
  return map;
}

const listRoute = createRoute({
  operationId: 'listMovies',
  method: 'get',
  path: '/api/movies',
  tags: [Tags.MOVIES],
  summary: 'List titles',
  description:
    'Paginated catalog of movies and series. Text search (`q`) matches title, director, and actor names. Supports combinable filters by type, year, genre(s), minRating, and minVotes. Sortable by rating, year, numVotes, title, or createdAt (default rating desc).',
  request: { query: moviesQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: titleListSchema } },
      description: 'List of titles',
    },
    400: { ...jsonError, description: 'Validation error' },
  },
});

const popularRoute = createRoute({
  operationId: 'listPopularMovies',
  method: 'get',
  path: '/api/movies/popular',
  tags: [Tags.MOVIES],
  summary: 'Popular titles',
  description:
    'Top titles ranked by IMDb rating then vote count (both desc). Optionally filter by type. Max limit 50.',
  request: {
    query: z.object({
      type: z.enum(['movie', 'series']).optional().openapi({ description: 'Filter by type.' }),
      page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1).openapi({ example: 1 }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .openapi({ example: 10, description: 'Max 50.' }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: titleListSchema } },
      description: 'Popular titles',
    },
    400: { ...jsonError, description: 'Validation error' },
  },
});

const autocompleteResponseSchema = z
  .object({
    data: z.array(
      z.object({
        id: z.number().int().openapi({ example: 889 }),
        title: z.string().openapi({ example: 'Breaking Bad' }),
        year: z.number().int().openapi({ example: 2008 }),
        type: z.enum(['movie', 'series']).openapi({ example: 'series' }),
      }),
    ),
  })
  .openapi('AutocompleteResponse');

const autocompleteRoute = createRoute({
  operationId: 'autocompleteMovies',
  method: 'get',
  path: '/api/movies/autocomplete',
  tags: [Tags.MOVIES],
  summary: 'Autocomplete title search',
  description:
    'Quick title suggestions for `q`. Titles whose name starts with `q` rank before those that merely contain it. Max 20 results.',
  request: {
    query: z.object({
      q: z
        .string()
        .min(1)
        .max(100)
        .openapi({ description: 'Search prefix/substring (required).', example: 'Break' }),
      type: z.enum(['movie', 'series']).optional().openapi({ description: 'Filter by type.' }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .default(8)
        .openapi({ example: 8, description: 'Max 20.' }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: autocompleteResponseSchema } },
      description: 'Matching titles',
    },
    400: { ...jsonError, description: 'Validation error' },
  },
});

const detailRoute = createRoute({
  operationId: 'getMovie',
  method: 'get',
  path: '/api/movies/{id}',
  tags: [Tags.MOVIES],
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

const similarRoute = createRoute({
  operationId: 'listSimilarMovies',
  method: 'get',
  path: '/api/movies/{id}/similar',
  tags: [Tags.MOVIES],
  summary: 'List similar titles',
  description:
    'Returns other titles that share at least one genre with the target, ranked by number of shared genres (desc) then IMDb rating (desc). The target title itself is excluded. Returns an empty array if the target has no genres.',
  request: {
    params: z.object({ id: z.coerce.number().int().positive().openapi({ example: 889 }) }),
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .openapi({ example: 10, description: 'Max 50.' }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: similarTitlesSchema } },
      description: 'Similar titles',
    },
    404: { ...jsonError, description: 'Title not found' },
  },
});

type OptionalAuthVariables = {
  user: { sub: number; email: string } | null;
};

export const moviesRouter = new OpenAPIHono<{ Variables: OptionalAuthVariables }>({ defaultHook });

moviesRouter.use('/api/movies/:id', optionalAuth);

// Static routes must be registered before /{id} to avoid the param swallowing them.
moviesRouter.openapi(listRoute, async (c) => {
  const {
    q,
    type,
    year,
    genre,
    genres: genresParam,
    genreMode,
    yearFrom,
    yearTo,
    minRating,
    minVotes,
    sort,
    order,
    page,
    limit,
  } = c.req.valid('query');
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];

  if (q && q.trim() !== '') {
    conditions.push(titleSearchCondition(q));
  }
  if (type) {
    conditions.push(eq(titles.type, type));
  }
  if (year) {
    conditions.push(eq(titles.year, year));
  }
  if (yearFrom !== undefined) {
    conditions.push(sql`${titles.year} >= ${yearFrom}`);
  }
  if (yearTo !== undefined) {
    conditions.push(sql`${titles.year} <= ${yearTo}`);
  }
  if (minRating !== undefined) {
    conditions.push(sql`${titles.rating} >= ${minRating}`);
  }
  if (minVotes !== undefined) {
    conditions.push(sql`${titles.numVotes} >= ${minVotes}`);
  }

  if (genre) {
    conditions.push(genreExists(genre));
  }

  if (genresParam) {
    const names = genresParam
      .split(',')
      .map((g) => g.trim())
      .filter((g) => g !== '');
    if (names.length > 0) {
      if (genreMode === 'all') {
        for (const name of names) {
          conditions.push(genreExists(name));
        }
      } else {
        conditions.push(or(...names.map((name) => genreExists(name))) as SQL);
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRows = await db.select({ value: count() }).from(titles).where(whereClause);
  const total = totalRows[0]?.value ?? 0;

  const sortDir = order === 'asc' ? asc : desc;
  const rows = await db
    .select()
    .from(titles)
    .where(whereClause)
    .orderBy(sortDir(sortColumns[sort]), desc(titles.id))
    .limit(limit)
    .offset(offset);

  const genreMap = await fetchGenreMap(rows.map((r) => r.id));

  const data = rows.map((t) => ({
    id: t.id,
    type: t.type === 'movie' ? ('movie' as const) : ('series' as const),
    title: t.title,
    year: t.year,
    director: t.director ?? null,
    rating: Number(t.rating),
    posterUrl: t.posterUrl ?? null,
    genres: genreMap.get(t.id) ?? [],
    numVotes: t.numVotes,
  }));

  return c.json({ data, pagination: buildPagination(page, limit, Number(total)) }, 200);
});

moviesRouter.openapi(popularRoute, async (c) => {
  const { type, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  const whereClause = type ? eq(titles.type, type) : undefined;

  const totalRows = await db.select({ value: count() }).from(titles).where(whereClause);
  const total = totalRows[0]?.value ?? 0;

  const rows = await db
    .select()
    .from(titles)
    .where(whereClause)
    .orderBy(desc(titles.rating), desc(titles.numVotes), desc(titles.id))
    .limit(limit)
    .offset(offset);

  const genreMap = await fetchGenreMap(rows.map((r) => r.id));

  const data = rows.map((t) => ({
    id: t.id,
    type: t.type === 'movie' ? ('movie' as const) : ('series' as const),
    title: t.title,
    year: t.year,
    director: t.director ?? null,
    rating: Number(t.rating),
    posterUrl: t.posterUrl ?? null,
    genres: genreMap.get(t.id) ?? [],
    numVotes: t.numVotes,
  }));

  return c.json({ data, pagination: buildPagination(page, limit, Number(total)) }, 200);
});

moviesRouter.openapi(autocompleteRoute, async (c) => {
  const { q, type, limit } = c.req.valid('query');

  const pat = `%${escapeLikePattern(q)}%`;
  const prefixPat = `${escapeLikePattern(q)}%`;

  const conditions: SQL[] = [sql`${titles.title} ILIKE ${pat} ESCAPE '\\'`];
  if (type) conditions.push(eq(titles.type, type));

  const rankExpr = sql<number>`CASE WHEN ${titles.title} ILIKE ${prefixPat} ESCAPE '\\' THEN 0 ELSE 1 END`;

  const rows = await db
    .select({ id: titles.id, title: titles.title, year: titles.year, type: titles.type })
    .from(titles)
    .where(and(...conditions))
    .orderBy(asc(rankExpr), desc(titles.rating), desc(titles.numVotes))
    .limit(limit);

  const data = rows.map((t) => ({
    id: t.id,
    title: t.title,
    year: t.year,
    type: t.type === 'movie' ? ('movie' as const) : ('series' as const),
  }));

  return c.json({ data }, 200);
});

moviesRouter.openapi(detailRoute, async (c) => {
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
      numVotes: title.numVotes,
      posterUrl: title.posterUrl ?? null,
      backdropUrl: title.backdropUrl ?? null,
      trailerUrl: trailerWatchUrl(title.trailerKey),
      genres: titleGenreRows.map((g) => g.name),
      seasonsCount: title.seasonsCount ?? null,
      episodesCount: title.episodesCount ?? null,
      cast: castRows.map((r) => ({ id: r.personId, name: r.name, character: r.character ?? null })),
      isFavorite,
    },
    200,
  );
});

moviesRouter.openapi(similarRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { limit } = c.req.valid('query');

  const [title] = await db.select({ id: titles.id }).from(titles).where(eq(titles.id, id)).limit(1);
  if (!title) {
    return errorResponse(c, ErrorCode.NOT_FOUND, 'Title not found') as never;
  }

  const targetGenreRows = await db
    .select({ genreId: titleGenres.genreId })
    .from(titleGenres)
    .where(eq(titleGenres.titleId, id));
  const genreIds = targetGenreRows.map((g) => g.genreId);

  if (genreIds.length === 0) {
    return c.json({ data: [] }, 200);
  }

  const sharedCount = sql<number>`count(*)`.as('shared_count');
  const ranked = await db
    .select({
      id: titles.id,
      type: titles.type,
      title: titles.title,
      year: titles.year,
      director: titles.director,
      rating: titles.rating,
      posterUrl: titles.posterUrl,
      numVotes: titles.numVotes,
      sharedCount,
    })
    .from(titles)
    .innerJoin(titleGenres, eq(titleGenres.titleId, titles.id))
    .where(and(inArray(titleGenres.genreId, genreIds), sql`${titles.id} <> ${id}`))
    .groupBy(titles.id)
    .orderBy(desc(sharedCount), desc(titles.rating), desc(titles.id))
    .limit(limit);

  const genreMap = await fetchGenreMap(ranked.map((r) => r.id));

  const data = ranked.map((t) => ({
    id: t.id,
    type: t.type === 'movie' ? ('movie' as const) : ('series' as const),
    title: t.title,
    year: t.year,
    director: t.director ?? null,
    rating: Number(t.rating),
    posterUrl: t.posterUrl ?? null,
    genres: genreMap.get(t.id) ?? [],
    numVotes: t.numVotes,
  }));

  return c.json({ data }, 200);
});
