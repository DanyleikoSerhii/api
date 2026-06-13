import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, isNull } from 'drizzle-orm';
import { titles } from '../db/schema.js';
import { env } from '../env.js';
import {
  findByImdbId,
  getDetails,
  pickTrailerKey,
  posterUrlFromPath,
  backdropUrlFromPath,
  mediaTypeFor,
} from '../lib/tmdb.js';

const RATE_LIMIT_MS = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!env.TMDB_ACCESS_TOKEN) {
    console.error('TMDB_ACCESS_TOKEN is required to run enrichment. Set it in .env.');
    process.exit(1);
  }

  // --force re-processes every title; default only fills unmatched ones (resume).
  const force = process.argv.includes('--force');
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db
    .select({ id: titles.id, imdbId: titles.imdbId, type: titles.type })
    .from(titles)
    .where(force ? undefined : isNull(titles.tmdbId));

  console.log(`Enriching ${rows.length} titles${force ? ' (--force)' : ''}...`);

  let matched = 0;
  let withTrailer = 0;
  let skipped = 0;

  for (const [i, t] of rows.entries()) {
    try {
      const mediaType = mediaTypeFor(t.type);
      const tmdbId = await findByImdbId(t.imdbId, mediaType);
      if (tmdbId == null) {
        skipped++;
      } else {
        const details = await getDetails(mediaType, tmdbId);
        const trailerKey = pickTrailerKey(details.videos?.results);
        const poster = posterUrlFromPath(details.poster_path);
        const backdrop = backdropUrlFromPath(details.backdrop_path);
        const overview = details.overview?.trim() ? details.overview : null;

        const update: Partial<typeof titles.$inferInsert> = {
          tmdbId,
          trailerKey,
          backdropUrl: backdrop,
        };
        // Never overwrite an existing value with null.
        if (poster) update.posterUrl = poster;
        if (overview) update.description = overview;

        await db.update(titles).set(update).where(eq(titles.id, t.id));
        matched++;
        if (trailerKey) withTrailer++;
      }
    } catch (err) {
      skipped++;
      console.warn(`skip ${t.imdbId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if ((i + 1) % 50 === 0) {
      console.log(`${i + 1}/${rows.length} processed`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`Done. matched=${matched} withTrailer=${withTrailer} skipped=${skipped}`);
  await pool.end();
}

await main();
