import { describe, it, expect } from 'vitest';
import {
  pickTrailerKey,
  posterUrlFromPath,
  backdropUrlFromPath,
  trailerWatchUrl,
  mediaTypeFor,
} from '../src/lib/tmdb.js';

describe('pickTrailerKey', () => {
  it('prefers an official YouTube Trailer over teasers and non-YouTube', () => {
    const key = pickTrailerKey([
      { site: 'Vimeo', type: 'Trailer', key: 'vimeo1', official: true },
      { site: 'YouTube', type: 'Teaser', key: 'teaser1', official: true },
      { site: 'YouTube', type: 'Trailer', key: 'trailer1', official: true },
    ]);
    expect(key).toBe('trailer1');
  });

  it('prefers official over unofficial when both are trailers', () => {
    const key = pickTrailerKey([
      { site: 'YouTube', type: 'Trailer', key: 'unofficial', official: false },
      { site: 'YouTube', type: 'Trailer', key: 'official', official: true },
    ]);
    expect(key).toBe('official');
  });

  it('returns null when there is no usable YouTube video', () => {
    expect(
      pickTrailerKey([{ site: 'Vimeo', type: 'Trailer', key: 'v', official: true }]),
    ).toBeNull();
    expect(pickTrailerKey([])).toBeNull();
    expect(pickTrailerKey(undefined)).toBeNull();
  });
});

describe('url builders', () => {
  it('builds poster and backdrop URLs from paths', () => {
    expect(posterUrlFromPath('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(backdropUrlFromPath('/bd.jpg')).toBe('https://image.tmdb.org/t/p/w1280/bd.jpg');
    expect(posterUrlFromPath(null)).toBeNull();
    expect(backdropUrlFromPath(undefined)).toBeNull();
  });

  it('builds a YouTube watch URL from a key', () => {
    expect(trailerWatchUrl('xyz')).toBe('https://www.youtube.com/watch?v=xyz');
    expect(trailerWatchUrl(null)).toBeNull();
  });
});

describe('mediaTypeFor', () => {
  it('maps catalog type to TMDB media type', () => {
    expect(mediaTypeFor('series')).toBe('tv');
    expect(mediaTypeFor('movie')).toBe('movie');
  });
});
