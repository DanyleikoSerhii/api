import { config } from 'dotenv';
config();

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { titles, genres, titleGenres, people, titleCast } from '../db/schema.js';

const MIN_RATING = 7.5;
const MIN_VOTES = 50_000;
const MAX_CAST = 10;

type TitleData = {
  tconst: string;
  type: 'movie' | 'series';
  title: string;
  year: number;
  endYear: number | null;
  rating: number;
  numVotes: number;
  director: string | null;
  seasonsCount: number | null;
  episodesCount: number | null;
};

type CastEntry = {
  tconst: string;
  nconst: string;
  ordering: number;
  character: string | null;
};

async function streamLines(filePath: string, onLine: (cols: string[]) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });
    let first = true;
    rl.on('line', (line) => {
      if (first) {
        first = false;
        return;
      } // skip header
      onLine(line.split('\t'));
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
}

async function main() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL']! });
  const db = drizzle(pool);

  // Pass 1: qualifying set by rating
  console.log('Pass 1: reading title.ratings.tsv...');
  const qualifyingTconst = new Set<string>();
  const ratingMap = new Map<string, { rating: number; numVotes: number }>();
  let pass1Count = 0;
  await streamLines('seeds/title.ratings.tsv', (cols) => {
    const [tconst, avgRatingStr, numVotesStr] = cols;
    if (!tconst || !avgRatingStr || !numVotesStr) return;
    const avgRating = parseFloat(avgRatingStr);
    const numVotes = parseInt(numVotesStr, 10);
    if (avgRating >= MIN_RATING && numVotes >= MIN_VOTES) {
      qualifyingTconst.add(tconst);
      ratingMap.set(tconst, { rating: avgRating, numVotes });
    }
    pass1Count++;
    if (pass1Count % 500_000 === 0) console.log(`  Pass 1: ${pass1Count} rows processed`);
  });
  console.log(`Pass 1 done: ${qualifyingTconst.size} qualifying tconst`);

  // Pass 2: filter titles
  console.log('Pass 2: reading title.basics.tsv...');
  const titleMap = new Map<string, TitleData>();
  let pass2Count = 0;
  await streamLines('seeds/title.basics.tsv', (cols) => {
    const [tconst, titleType, primaryTitle, , isAdult, startYear, endYearRaw, , genresRaw] = cols;
    pass2Count++;
    if (pass2Count % 1_000_000 === 0) console.log(`  Pass 2: ${pass2Count} rows processed`);

    if (!tconst || !titleType || !primaryTitle || !startYear || !endYearRaw || !genresRaw) return;
    if (!qualifyingTconst.has(tconst)) return;
    if (!['movie', 'tvSeries', 'tvMiniSeries'].includes(titleType)) return;
    if (isAdult === '1') return;
    if (startYear === '\\N') return;
    if (genresRaw === '\\N') return;

    const type: 'movie' | 'series' = titleType === 'movie' ? 'movie' : 'series';
    const endYear = endYearRaw === '\\N' ? null : parseInt(endYearRaw, 10);
    const ratingData = ratingMap.get(tconst)!;

    titleMap.set(tconst, {
      tconst,
      type,
      title: primaryTitle,
      year: parseInt(startYear, 10),
      endYear,
      rating: ratingData.rating,
      numVotes: ratingData.numVotes,
      director: null,
      seasonsCount: null,
      episodesCount: null,
    });
  });

  const movies = [...titleMap.values()].filter((t) => t.type === 'movie').length;
  const series = [...titleMap.values()].filter((t) => t.type === 'series').length;
  console.log(
    `Pass 2 done: Qualified: ${titleMap.size} titles (${movies} movies, ${series} series)`,
  );

  // Pass 3: seasons and episodes
  console.log('Pass 3: reading title.episode.tsv...');
  let pass3Count = 0;
  await streamLines('seeds/title.episode.tsv', (cols) => {
    const [, parentTconst, seasonNumberRaw] = cols;
    pass3Count++;
    if (pass3Count % 1_000_000 === 0) console.log(`  Pass 3: ${pass3Count} rows processed`);

    if (!parentTconst || !seasonNumberRaw) return;
    const titleData = titleMap.get(parentTconst);
    if (!titleData || titleData.type !== 'series') return;

    titleData.episodesCount = (titleData.episodesCount ?? 0) + 1;
    if (seasonNumberRaw !== '\\N') {
      const season = parseInt(seasonNumberRaw, 10);
      if (!isNaN(season)) {
        titleData.seasonsCount = Math.max(titleData.seasonsCount ?? 0, season);
      }
    }
  });
  console.log(`Pass 3 done: ${pass3Count} episode rows processed`);

  // Pass 4: directors
  console.log('Pass 4: reading title.crew.tsv...');
  const directorNconsts = new Set<string>();
  let pass4Count = 0;
  await streamLines('seeds/title.crew.tsv', (cols) => {
    const [tconst, directorsRaw] = cols;
    pass4Count++;
    if (pass4Count % 1_000_000 === 0) console.log(`  Pass 4: ${pass4Count} rows processed`);

    if (!tconst || !directorsRaw) return;
    const titleData = titleMap.get(tconst);
    if (!titleData) return;

    if (directorsRaw !== '\\N') {
      const firstDirector = directorsRaw.split(',')[0];
      if (!firstDirector) return;
      titleData.director = firstDirector; // temporarily store nconst; resolve in pass 6
      directorNconsts.add(firstDirector);
    }
  });
  console.log(`Pass 4 done: ${directorNconsts.size} unique director nconsts`);

  // Pass 5: cast from principals
  console.log('Pass 5: reading title.principals.tsv (4.2 GB, slowest pass)...');
  const castEntries: CastEntry[] = [];
  const actorNconsts = new Set<string>();
  let pass5Count = 0;
  await streamLines('seeds/title.principals.tsv', (cols) => {
    const [tconst, orderingStr, nconst, category, , charactersRaw] = cols;
    pass5Count++;
    if (pass5Count % 1_000_000 === 0) console.log(`  Pass 5: ${pass5Count} rows processed`);

    if (!tconst || !orderingStr || !nconst || !category || !charactersRaw) return;
    if (!titleMap.has(tconst)) return;
    if (category !== 'actor' && category !== 'actress') return;
    const ordering = parseInt(orderingStr, 10);
    if (ordering > MAX_CAST) return;

    let character: string | null = null;
    if (charactersRaw !== '\\N') {
      try {
        const parsed: unknown = JSON.parse(charactersRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          character = String(parsed[0]);
        }
      } catch {
        character = null;
      }
    }

    castEntries.push({ tconst, nconst, ordering, character });
    actorNconsts.add(nconst);
  });
  console.log(
    `Pass 5 done: ${castEntries.length} cast entries, ${actorNconsts.size} unique actors`,
  );

  // Pass 6: resolve names (directors + actors only)
  console.log('Pass 6: reading name.basics.tsv...');
  const neededNconsts = new Set<string>([...directorNconsts, ...actorNconsts]);
  const nameMap = new Map<string, string>();
  let pass6Count = 0;
  await streamLines('seeds/name.basics.tsv', (cols) => {
    const [nconst, primaryName] = cols;
    pass6Count++;
    if (pass6Count % 1_000_000 === 0) console.log(`  Pass 6: ${pass6Count} rows processed`);

    if (!nconst || !primaryName) return;
    if (neededNconsts.has(nconst)) {
      nameMap.set(nconst, primaryName);
    }
  });
  console.log(`Pass 6 done: resolved ${nameMap.size} names out of ${neededNconsts.size} needed`);

  // Resolve director nconsts to names
  for (const titleData of titleMap.values()) {
    if (titleData.director !== null) {
      titleData.director = nameMap.get(titleData.director) ?? null;
    }
  }

  // Insert into DB
  console.log('Inserting into database...');

  // Collect all genre names
  const allGenreNames = new Set<string>();
  // Re-read basics just for genres of qualifying titles
  // Instead, collect from a second pass of titleMap — we need genres from pass 2
  // We stored genres separately:
  const titleGenreNames = new Map<string, string[]>();
  await streamLines('seeds/title.basics.tsv', (cols) => {
    const [tconst, , , , , , , , genresRaw] = cols;
    if (!tconst || !genresRaw) return;
    if (!titleMap.has(tconst)) return;
    if (genresRaw === '\\N') return;
    const genreList = genresRaw
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
    titleGenreNames.set(tconst, genreList);
    for (const g of genreList) allGenreNames.add(g);
  });

  // Insert genres
  const genreNameArr = [...allGenreNames].sort();
  console.log(`Inserting ${genreNameArr.length} genres...`);
  for (let i = 0; i < genreNameArr.length; i += 100) {
    const batch = genreNameArr.slice(i, i + 100).map((name) => ({ name }));
    await db.insert(genres).values(batch).onConflictDoNothing();
  }

  // Fetch genre id map
  const genreRows = await db.select().from(genres);
  const genreIdMap = new Map(genreRows.map((g) => [g.name, g.id]));

  // Insert people (actors + directors)
  const allPeopleNconsts = new Set<string>([...directorNconsts, ...actorNconsts]);
  const peopleArr = [...allPeopleNconsts]
    .filter((nconst) => nameMap.has(nconst))
    .map((nconst) => ({ imdbId: nconst, name: nameMap.get(nconst)! }));

  console.log(`Inserting ${peopleArr.length} people...`);
  for (let i = 0; i < peopleArr.length; i += 100) {
    const batch = peopleArr.slice(i, i + 100);
    await db.insert(people).values(batch).onConflictDoNothing();
  }

  // Fetch people id map
  const peopleRows = await db.select({ id: people.id, imdbId: people.imdbId }).from(people);
  const peopleIdMap = new Map(peopleRows.map((p) => [p.imdbId, p.id]));

  // Insert titles in batches
  const titlesArr = [...titleMap.values()];
  console.log(`Inserting ${titlesArr.length} titles...`);
  const insertedTitleIds = new Map<string, number>(); // tconst -> db id

  for (let i = 0; i < titlesArr.length; i += 100) {
    const batch = titlesArr.slice(i, i + 100);
    const values = batch.map((t) => ({
      imdbId: t.tconst,
      type: t.type,
      title: t.title,
      year: t.year,
      endYear: t.endYear,
      director: t.director,
      description: null,
      rating: String(t.rating),
      numVotes: t.numVotes,
      seasonsCount: t.seasonsCount,
      episodesCount: t.episodesCount,
      posterUrl: `https://placehold.co/300x450?text=${encodeURIComponent(t.title.slice(0, 30))}`,
    }));
    const inserted = await db
      .insert(titles)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: titles.id, imdbId: titles.imdbId });

    for (const row of inserted) {
      insertedTitleIds.set(row.imdbId, row.id);
    }

    if ((i / 100 + 1) % 10 === 0) {
      console.log(`  Titles: inserted ${Math.min(i + 100, titlesArr.length)}/${titlesArr.length}`);
    }
  }

  // For titles that already existed (on conflict do nothing), fetch their ids
  const missingTconsts = titlesArr.map((t) => t.tconst).filter((tc) => !insertedTitleIds.has(tc));
  if (missingTconsts.length > 0) {
    for (let i = 0; i < missingTconsts.length; i += 100) {
      const batch = missingTconsts.slice(i, i + 100);
      const res = await pool.query(`SELECT id, imdb_id FROM titles WHERE imdb_id = ANY($1)`, [
        batch,
      ]);
      const rows = res.rows.map((r: { id: number; imdb_id: string }) => ({
        id: r.id,
        imdbId: r.imdb_id,
      }));
      for (const row of rows) {
        insertedTitleIds.set(row.imdbId, row.id);
      }
    }
  }

  // Insert title_genres
  console.log('Inserting title_genres...');
  const titleGenreValues: { titleId: number; genreId: number }[] = [];
  for (const [tconst, genreList] of titleGenreNames) {
    const titleId = insertedTitleIds.get(tconst);
    if (!titleId) continue;
    for (const genreName of genreList) {
      const genreId = genreIdMap.get(genreName);
      if (genreId) titleGenreValues.push({ titleId, genreId });
    }
  }
  for (let i = 0; i < titleGenreValues.length; i += 100) {
    const batch = titleGenreValues.slice(i, i + 100);
    await db.insert(titleGenres).values(batch).onConflictDoNothing();
  }
  console.log(`  Inserted ${titleGenreValues.length} title_genre rows`);

  // Insert title_cast
  console.log('Inserting title_cast...');
  let castInserted = 0;
  const castValues: { titleId: number; personId: number; character: string | null; ord: number }[] =
    [];
  for (const entry of castEntries) {
    const titleId = insertedTitleIds.get(entry.tconst);
    const personId = peopleIdMap.get(entry.nconst);
    if (!titleId || !personId) continue;
    castValues.push({ titleId, personId, character: entry.character, ord: entry.ordering });
  }
  for (let i = 0; i < castValues.length; i += 100) {
    const batch = castValues.slice(i, i + 100);
    await db.insert(titleCast).values(batch).onConflictDoNothing();
    castInserted += batch.length;
    if (castInserted % 5_000 === 0) console.log(`  Cast: ${castInserted}/${castValues.length}`);
  }
  console.log(`  Inserted ${castInserted} title_cast rows`);

  // Final stats
  type CountRow = { count: string };
  const titleCountRes = await pool.query<CountRow>('SELECT COUNT(*) as count FROM titles');
  const seriesCountRes = await pool.query<CountRow>(
    "SELECT COUNT(*) as count FROM titles WHERE type = 'series'",
  );
  const genreCountRes = await pool.query<CountRow>('SELECT COUNT(*) as count FROM genres');
  const castCountRes = await pool.query<CountRow>('SELECT COUNT(*) as count FROM title_cast');

  console.log('\n=== Seed complete ===');
  console.log(`Titles: ${titleCountRes.rows[0]?.count ?? 0}`);
  console.log(`Series: ${seriesCountRes.rows[0]?.count ?? 0}`);
  console.log(`Genres: ${genreCountRes.rows[0]?.count ?? 0}`);
  console.log(`Cast rows: ${castCountRes.rows[0]?.count ?? 0}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
