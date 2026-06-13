import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { people, titleCast, titles } from '../db/schema.js';
import { errorResponse, ErrorCode, defaultHook } from '../lib/errors.js';

const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('PeopleError');

const filmographyItemSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    type: z.enum(['movie', 'series']),
    year: z.number().int(),
    rating: z.number(),
    posterUrl: z.string().nullable(),
    character: z.string().nullable(),
    ord: z.number().int(),
  })
  .openapi('FilmographyItem');

const personDetailSchema = z
  .object({
    id: z.number().int(),
    imdbId: z.string(),
    name: z.string(),
    filmography: z.array(filmographyItemSchema),
  })
  .openapi('PersonDetail');

const jsonError = { content: { 'application/json': { schema: errorSchema } } };

const detailRoute = createRoute({
  method: 'get',
  path: '/api/people/{id}',
  tags: ['People'],
  summary: 'Get a person by id',
  description:
    'Returns the person plus their filmography (cast credits joined with titles), ordered by title rating descending. Filmography may be empty for directors with no cast rows.',
  request: {
    params: z.object({ id: z.coerce.number().int().positive().openapi({ example: 5 }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: personDetailSchema } },
      description: 'Person detail',
    },
    404: { ...jsonError, description: 'Person not found' },
  },
});

export const peopleRouter = new OpenAPIHono({ defaultHook });

peopleRouter.openapi(detailRoute, async (c) => {
  const { id } = c.req.valid('param');

  const [person] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  if (!person) {
    return errorResponse(c, ErrorCode.NOT_FOUND, 'Person not found') as never;
  }

  const filmographyRows = await db
    .select({
      id: titles.id,
      title: titles.title,
      type: titles.type,
      year: titles.year,
      rating: titles.rating,
      posterUrl: titles.posterUrl,
      character: titleCast.character,
      ord: titleCast.ord,
    })
    .from(titleCast)
    .innerJoin(titles, eq(titleCast.titleId, titles.id))
    .where(eq(titleCast.personId, id))
    .orderBy(desc(titles.rating));

  return c.json(
    {
      id: person.id,
      imdbId: person.imdbId,
      name: person.name,
      filmography: filmographyRows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type === 'movie' ? ('movie' as const) : ('series' as const),
        year: r.year,
        rating: Number(r.rating),
        posterUrl: r.posterUrl ?? null,
        character: r.character ?? null,
        ord: r.ord,
      })),
    },
    200,
  );
});
