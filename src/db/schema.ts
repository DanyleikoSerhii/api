import {
  pgTable,
  serial,
  varchar,
  smallint,
  integer,
  numeric,
  text,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    nickname: varchar('nickname', { length: 50 }),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    avatar: text('avatar'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => [
    // Case-insensitive uniqueness; multiple NULL nicknames are allowed.
    uniqueIndex('users_nickname_lower_idx').on(sql`lower(${t.nickname})`),
  ],
);

export const titles = pgTable(
  'titles',
  {
    id: serial('id').primaryKey(),
    imdbId: varchar('imdb_id', { length: 20 }).notNull().unique(),
    type: varchar('type', { length: 10 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    year: smallint('year').notNull(),
    endYear: smallint('end_year'),
    director: varchar('director', { length: 255 }),
    description: text('description'),
    rating: numeric('rating', { precision: 3, scale: 1 }).notNull(),
    numVotes: integer('num_votes').notNull(),
    seasonsCount: smallint('seasons_count'),
    episodesCount: integer('episodes_count'),
    posterUrl: varchar('poster_url', { length: 1000 }),
    backdropUrl: varchar('backdrop_url', { length: 1000 }),
    tmdbId: integer('tmdb_id'),
    trailerKey: varchar('trailer_key', { length: 20 }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => [
    index('titles_year_idx').on(t.year),
    index('titles_type_idx').on(t.type),
    index('titles_rating_idx').on(t.rating),
    check('titles_type_check', sql`${t.type} IN ('movie', 'series')`),
  ],
);

export const genres = pgTable('genres', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
});

export const titleGenres = pgTable(
  'title_genres',
  {
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    genreId: integer('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.titleId, t.genreId] }),
    index('title_genres_genre_id_idx').on(t.genreId),
  ],
);

export const people = pgTable('people', {
  id: serial('id').primaryKey(),
  imdbId: varchar('imdb_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
});

export const titleCast = pgTable(
  'title_cast',
  {
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    character: varchar('character', { length: 500 }),
    ord: smallint('ord').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.titleId, t.ord] }),
    index('title_cast_person_id_idx').on(t.personId),
  ],
);

export const favorites = pgTable(
  'favorites',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at').defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.titleId] })],
);
