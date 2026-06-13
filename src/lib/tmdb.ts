import { env } from '../env.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export type MediaType = 'movie' | 'tv';

export type TmdbVideo = {
  site: string;
  type: string;
  key: string;
  official: boolean;
};

export type TmdbDetails = {
  id: number;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  videos?: { results: TmdbVideo[] };
};

// --- Pure helpers (unit-tested; no network) -------------------------------

/** Maps our catalog `type` to the TMDB media path segment. */
export function mediaTypeFor(titleType: string): MediaType {
  return titleType === 'series' ? 'tv' : 'movie';
}

/**
 * Picks the best YouTube trailer key: official Trailer > Trailer > official
 * Teaser > Teaser. Returns null when there is no usable YouTube video.
 */
export function pickTrailerKey(videos: TmdbVideo[] | undefined): string | null {
  const youtube = (videos ?? []).filter((v) => v.site === 'YouTube' && v.key);
  if (youtube.length === 0) return null;
  const score = (v: TmdbVideo): number =>
    (v.type === 'Trailer' ? 2 : v.type === 'Teaser' ? 1 : 0) + (v.official ? 1 : 0);
  let best = youtube[0]!;
  for (const v of youtube) {
    if (score(v) > score(best)) best = v;
  }
  return best.key;
}

export function posterUrlFromPath(path: string | null | undefined): string | null {
  return path ? `${IMAGE_BASE}/w500${path}` : null;
}

export function backdropUrlFromPath(path: string | null | undefined): string | null {
  return path ? `${IMAGE_BASE}/w1280${path}` : null;
}

export function trailerWatchUrl(key: string | null | undefined): string | null {
  return key ? `https://www.youtube.com/watch?v=${key}` : null;
}

// --- Network client (used only by the enrichment script) ------------------

function authHeaders(): Record<string, string> {
  const token = env.TMDB_ACCESS_TOKEN;
  if (!token) {
    throw new Error('TMDB_ACCESS_TOKEN is not set');
  }
  return { Authorization: `Bearer ${token}`, accept: 'application/json' };
}

/** Resolves an IMDb id to a TMDB id for the given media type, or null. */
export async function findByImdbId(imdbId: string, type: MediaType): Promise<number | null> {
  const res = await fetch(`${TMDB_BASE}/find/${imdbId}?external_source=imdb_id`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`TMDB find failed (${res.status}) for ${imdbId}`);
  }
  const data = (await res.json()) as {
    movie_results?: { id: number }[];
    tv_results?: { id: number }[];
  };
  const results = type === 'tv' ? data.tv_results : data.movie_results;
  return results?.[0]?.id ?? null;
}

export async function getDetails(type: MediaType, tmdbId: number): Promise<TmdbDetails> {
  const res = await fetch(`${TMDB_BASE}/${type}/${tmdbId}?append_to_response=videos`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`TMDB details failed (${res.status}) for ${type}/${tmdbId}`);
  }
  return (await res.json()) as TmdbDetails;
}
