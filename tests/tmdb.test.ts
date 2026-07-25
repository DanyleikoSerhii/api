import { describe, it, expect } from 'vitest';
import {
  pickTrailerKey,
  posterUrlFromPath,
  backdropUrlFromPath,
  trailerEmbedUrl,
  posterThumbUrl,
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

  it('builds an embeddable YouTube URL from a key', () => {
    expect(trailerEmbedUrl('xyz')).toBe('https://www.youtube.com/embed/xyz');
    expect(trailerEmbedUrl(null)).toBeNull();
  });

  it('shrinks a stored TMDB poster to the w92 thumbnail', () => {
    expect(posterThumbUrl('https://image.tmdb.org/t/p/w500/abc.jpg')).toBe(
      'https://image.tmdb.org/t/p/w92/abc.jpg',
    );
  });

  it('passes non-TMDB posters through untouched', () => {
    // 8 prod titles fall back to placehold.co — those must not be rewritten.
    const placeholder = 'https://placehold.co/300x450?text=Twin%20Peaks';
    expect(posterThumbUrl(placeholder)).toBe(placeholder);
    // A TMDB URL at some other size is left alone rather than guessed at.
    const w780 = 'https://image.tmdb.org/t/p/w780/abc.jpg';
    expect(posterThumbUrl(w780)).toBe(w780);
    expect(posterThumbUrl(null)).toBeNull();
    expect(posterThumbUrl(undefined)).toBeNull();
  });
});

describe('mediaTypeFor', () => {
  it('maps catalog type to TMDB media type', () => {
    expect(mediaTypeFor('series')).toBe('tv');
    expect(mediaTypeFor('movie')).toBe('movie');
  });
});
