import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '../../src/db/schema.js';
import { resetRateLimitStore } from '../../src/middleware/rateLimit.js';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres:postgres@localhost:5433/movie_explorer_test';

// globalSetup: runs in a separate vitest worker — handles DB creation + migration + seed
export async function setup() {
  // Ensure the test database exists
  const baseUrl = TEST_DB_URL.replace(/\/[^/?]+(\?.*)?$/, '/postgres');
  const dbName = new URL(TEST_DB_URL).pathname.slice(1);
  const adminPool = new Pool({ connectionString: baseUrl });
  try {
    const res = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if ((res.rowCount ?? 0) === 0) {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await adminPool.end();
  }

  const pool = new Pool({ connectionString: TEST_DB_URL });
  const db = drizzle(pool, { schema });

  // The pg_trgm extension backs the gin_trgm_ops index in the migration.
  // CREATE EXTENSION was dropped from the migration for Nile compatibility,
  // so enable it here for the local test database before migrating.
  await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  await migrate(db, { migrationsFolder: './drizzle/migrations' });
  await seedTestData(db);

  await pool.end();
}

export async function teardown() {
  // nothing — pool is closed in setup
}

async function seedTestData(db: ReturnType<typeof drizzle<typeof schema>>) {
  await db.delete(schema.titleCast);
  await db.delete(schema.titleGenres);
  await db.delete(schema.favorites);
  await db.delete(schema.users);
  await db.delete(schema.titles);
  await db.delete(schema.genres);
  await db.delete(schema.people);

  const genreRows = await db
    .insert(schema.genres)
    .values([{ name: 'Drama' }, { name: 'Crime' }, { name: 'Action' }, { name: 'Thriller' }])
    .returning();

  const genreMap = new Map(genreRows.map((g) => [g.name, g.id]));

  const peopleRows = await db
    .insert(schema.people)
    .values([
      { imdbId: 'nm0000001', name: 'Frank Darabont' },
      { imdbId: 'nm0000002', name: 'Tim Robbins' },
      { imdbId: 'nm0000003', name: 'Morgan Freeman' },
      { imdbId: 'nm0000004', name: 'Vince Gilligan' },
      { imdbId: 'nm0000005', name: 'Bryan Cranston' },
    ])
    .returning();

  const personMap = new Map(peopleRows.map((p) => [p.imdbId, p.id]));

  const titleRows = await db
    .insert(schema.titles)
    .values([
      {
        imdbId: 'tt0000001',
        type: 'movie',
        title: 'The Shawshank Redemption',
        year: 1994,
        director: 'Frank Darabont',
        rating: '9.3',
        numVotes: 2500000,
        posterUrl: 'https://placehold.co/300x450?text=Shawshank',
      },
      {
        imdbId: 'tt0000002',
        type: 'movie',
        title: 'The Godfather',
        year: 1972,
        director: 'Francis Ford Coppola',
        rating: '9.2',
        numVotes: 1800000,
        posterUrl: 'https://placehold.co/300x450?text=Godfather',
      },
      {
        imdbId: 'tt0000003',
        type: 'movie',
        title: 'The Dark Knight',
        year: 2008,
        director: 'Christopher Nolan',
        rating: '9.0',
        numVotes: 2700000,
        posterUrl: 'https://placehold.co/300x450?text=DarkKnight',
      },
      {
        imdbId: 'tt0000004',
        type: 'movie',
        title: "Schindler's List",
        year: 1993,
        director: 'Steven Spielberg',
        rating: '9.0',
        numVotes: 1400000,
        posterUrl: 'https://placehold.co/300x450?text=Schindler',
      },
      {
        imdbId: 'tt0000005',
        type: 'movie',
        title: 'Pulp Fiction',
        year: 1994,
        director: 'Quentin Tarantino',
        rating: '8.9',
        numVotes: 2100000,
        posterUrl: 'https://placehold.co/300x450?text=PulpFiction',
      },
      {
        imdbId: 'tt0000006',
        type: 'series',
        title: 'Breaking Bad',
        year: 2008,
        endYear: 2013,
        director: 'Vince Gilligan',
        rating: '9.5',
        numVotes: 2000000,
        seasonsCount: 5,
        episodesCount: 62,
        posterUrl: 'https://placehold.co/300x450?text=BreakingBad',
        backdropUrl: 'https://image.tmdb.org/t/p/w1280/bb.jpg',
        trailerKey: 'HhesaQXLuRY',
      },
      {
        imdbId: 'tt0000007',
        type: 'series',
        title: 'The Wire',
        year: 2002,
        endYear: 2008,
        director: 'David Simon',
        rating: '9.3',
        numVotes: 350000,
        seasonsCount: 5,
        episodesCount: 60,
        posterUrl: 'https://placehold.co/300x450?text=TheWire',
      },
    ])
    .returning();

  const titleMap = new Map(titleRows.map((t) => [t.imdbId, t.id]));

  await db.insert(schema.titleGenres).values([
    { titleId: titleMap.get('tt0000001')!, genreId: genreMap.get('Drama')! },
    { titleId: titleMap.get('tt0000001')!, genreId: genreMap.get('Crime')! },
    { titleId: titleMap.get('tt0000002')!, genreId: genreMap.get('Crime')! },
    { titleId: titleMap.get('tt0000002')!, genreId: genreMap.get('Drama')! },
    { titleId: titleMap.get('tt0000003')!, genreId: genreMap.get('Action')! },
    { titleId: titleMap.get('tt0000003')!, genreId: genreMap.get('Thriller')! },
    { titleId: titleMap.get('tt0000004')!, genreId: genreMap.get('Drama')! },
    { titleId: titleMap.get('tt0000005')!, genreId: genreMap.get('Crime')! },
    { titleId: titleMap.get('tt0000005')!, genreId: genreMap.get('Drama')! },
    { titleId: titleMap.get('tt0000006')!, genreId: genreMap.get('Crime')! },
    { titleId: titleMap.get('tt0000006')!, genreId: genreMap.get('Drama')! },
    { titleId: titleMap.get('tt0000006')!, genreId: genreMap.get('Thriller')! },
    { titleId: titleMap.get('tt0000007')!, genreId: genreMap.get('Crime')! },
    { titleId: titleMap.get('tt0000007')!, genreId: genreMap.get('Drama')! },
  ]);

  await db.insert(schema.titleCast).values([
    {
      titleId: titleMap.get('tt0000006')!,
      personId: personMap.get('nm0000005')!,
      character: 'Walter White',
      ord: 1,
    },
    {
      titleId: titleMap.get('tt0000001')!,
      personId: personMap.get('nm0000002')!,
      character: 'Andy Dufresne',
      ord: 1,
    },
    {
      titleId: titleMap.get('tt0000001')!,
      personId: personMap.get('nm0000003')!,
      character: 'Ellis Boyd Redding',
      ord: 2,
    },
  ]);
}

// truncateAll: uses own pool explicitly pointing at TEST_DB_URL
let _truncatePool: Pool | null = null;
let _truncateDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getTruncateDb() {
  if (!_truncatePool) {
    _truncatePool = new Pool({ connectionString: TEST_DB_URL });
    _truncateDb = drizzle(_truncatePool, { schema });
  }
  return _truncateDb!;
}

export async function truncateAll() {
  const db = getTruncateDb();
  await db.delete(schema.favorites);
  await db.delete(schema.users);
  resetRateLimitStore();
}
