import { z } from '@hono/zod-openapi';

export const Tags = {
  AUTH: 'Auth',
  MOVIES: 'Movies',
  GENRES: 'Genres',
  FAVORITES: 'Favorites',
} as const;

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z
        .enum(['VALIDATION_ERROR', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'INTERNAL_ERROR'])
        .openapi({ example: 'NOT_FOUND' }),
      message: z.string().openapi({ example: 'Title not found' }),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ErrorResponse', {
    description: 'Unified error envelope returned by every non-2xx response.',
  });

export const userSchema = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    email: z.string().email().openapi({ example: 'user@example.com' }),
  })
  .openapi('User');

export const authResponseSchema = z
  .object({
    token: z.string().openapi({
      example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      description: 'JWT access token. TTL 24h.',
    }),
    user: userSchema,
  })
  .openapi('AuthResponse');

export const credentialsSchema = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.trim().toLowerCase())
      .openapi({ example: 'user@example.com' }),
    password: z.string().min(8).max(72).openapi({
      example: 'secret12345',
      description: 'Plain text; hashed server-side with bcrypt. 8-72 chars.',
    }),
  })
  .openapi('Credentials');

// Base64 data-URI for the avatar. Capped well under the 1 MB request-body limit
// (~700k chars of base64 ≈ a ~0.5 MB image).
const avatarSchema = z
  .string()
  .max(700_000)
  .regex(
    /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*$/,
    'Must be a base64 image data URI (data:image/...;base64,...).',
  )
  .openapi({ description: 'Base64 image data URI. Send null to clear.' });

const nicknameSchema = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, digits, and _ . - are allowed.')
  .openapi({ example: 'cinephile_42' });

export const profileSchema = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    email: z.string().email().openapi({ example: 'user@example.com' }),
    nickname: z.string().nullable().openapi({ example: 'cinephile_42' }),
    firstName: z.string().nullable().openapi({ example: 'Ada' }),
    lastName: z.string().nullable().openapi({ example: 'Lovelace' }),
    avatar: z.string().nullable().openapi({ example: null }),
  })
  .openapi('Profile');

// PATCH body: every field optional; an explicit null clears that field.
export const updateProfileSchema = z
  .object({
    nickname: nicknameSchema.nullable(),
    firstName: z.string().trim().min(1).max(100).nullable(),
    lastName: z.string().trim().min(1).max(100).nullable(),
    avatar: avatarSchema.nullable(),
  })
  .partial()
  .openapi('UpdateProfile');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8).max(72).openapi({ example: 'secret12345' }),
    newPassword: z.string().min(8).max(72).openapi({ example: 'newSecret67890' }),
  })
  .openapi('ChangePassword');

export const paginationSchema = z
  .object({
    page: z.number().int().openapi({ example: 1 }),
    limit: z.number().int().openapi({ example: 20 }),
    total: z.number().int().openapi({ example: 245 }),
    totalPages: z.number().int().openapi({ example: 13 }),
  })
  .openapi('Pagination');

export const titleSummarySchema = z
  .object({
    id: z.number().int().openapi({ example: 520 }),
    type: z.enum(['movie', 'series']).openapi({ example: 'movie' }),
    title: z.string().openapi({ example: 'The Matrix' }),
    year: z.number().int().openapi({ example: 1999 }),
    director: z.string().nullable().openapi({ example: 'Lana Wachowski' }),
    rating: z.number().openapi({
      example: 8.7,
      description: 'IMDb averageRating (NUMERIC(3,1) coerced to number).',
    }),
    posterUrl: z
      .string()
      .nullable()
      .openapi({ example: 'https://placehold.co/300x450?text=The%20Matrix' }),
    genres: z.array(z.string()).openapi({ example: ['Action', 'Sci-Fi'] }),
    numVotes: z
      .number()
      .int()
      .optional()
      .openapi({ example: 1900000, description: 'IMDb numVotes. Omitted on some responses.' }),
  })
  .openapi('TitleSummary');

export const titleListSchema = z
  .object({
    data: z.array(titleSummarySchema),
    pagination: paginationSchema,
  })
  .openapi('TitleList');

export const similarTitlesSchema = z
  .object({
    data: z.array(titleSummarySchema),
  })
  .openapi('SimilarTitles');

export const castMemberSchema = z
  .object({
    id: z.number().int().openapi({ example: 7 }),
    name: z.string().openapi({ example: 'Bryan Cranston' }),
    character: z.string().nullable().openapi({ example: 'Walter White' }),
  })
  .openapi('CastMember');

export const titleDetailSchema = z
  .object({
    id: z.number().int().openapi({ example: 889 }),
    type: z.enum(['movie', 'series']).openapi({ example: 'series' }),
    title: z.string().openapi({ example: 'Breaking Bad' }),
    year: z.number().int().openapi({ example: 2008 }),
    endYear: z
      .number()
      .int()
      .nullable()
      .openapi({ example: 2013, description: 'null for movies and ongoing series.' }),
    director: z.string().nullable().openapi({ example: 'Vince Gilligan' }),
    description: z.string().nullable().openapi({
      description: 'Plot/overview. null until enriched from TMDB (IMDb dumps have no plot).',
    }),
    rating: z.number().openapi({ example: 9.5 }),
    numVotes: z.number().int().openapi({ example: 2000000, description: 'IMDb numVotes.' }),
    posterUrl: z.string().nullable(),
    backdropUrl: z
      .string()
      .nullable()
      .openapi({ description: 'Wide backdrop image (TMDB). null if unknown.' }),
    trailerUrl: z.string().nullable().openapi({
      example: 'https://www.youtube.com/watch?v=HhesaQXLuRY',
      description: 'YouTube trailer URL (TMDB). null if none.',
    }),
    genres: z.array(z.string()).openapi({ example: ['Crime', 'Drama', 'Thriller'] }),
    seasonsCount: z
      .number()
      .int()
      .nullable()
      .openapi({ example: 5, description: 'null for movies.' }),
    episodesCount: z
      .number()
      .int()
      .nullable()
      .openapi({ example: 62, description: 'null for movies.' }),
    cast: z
      .array(castMemberSchema)
      .openapi({ description: 'Up to 10 top-billed actors, sorted by IMDb ordering.' }),
    isFavorite: z.boolean().openapi({
      example: false,
      description:
        "true when the request carries a valid Bearer token and the title is in the user's favorites.",
    }),
  })
  .openapi('TitleDetail');

export const genresResponseSchema = z
  .object({
    data: z.array(z.string()).openapi({ example: ['Action', 'Crime', 'Drama', 'Thriller'] }),
  })
  .openapi('GenresResponse');

export const addFavoriteResponseSchema = z
  .object({
    titleId: z.number().int().openapi({ example: 889 }),
    addedAt: z
      .string()
      .openapi({ example: '2026-06-10T12:00:00.000Z', description: 'ISO 8601 timestamp (UTC).' }),
  })
  .openapi('AddFavoriteResponse');
