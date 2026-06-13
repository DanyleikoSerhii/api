import { describe, it, expect } from 'vitest';
import { request } from './helpers/request.js';
import { truncateAll } from './helpers/db.js';

describe('GET /api/people/:id', () => {
  it('returns person detail with filmography', async () => {
    await truncateAll();

    const listRes = await request('/api/titles?q=Breaking Bad&limit=1');
    const titleData = (listRes.body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(titleData.length).toBeGreaterThan(0);
    const breakingBadId = titleData[0]?.['id'] as number;

    const detailRes = await request(`/api/titles/${breakingBadId}`);
    const cast = (detailRes.body as Record<string, unknown>).cast as Record<string, unknown>[];
    expect(cast.length).toBeGreaterThan(0);
    const personId = cast[0]?.['id'] as number;

    const { status, body } = await request(`/api/people/${personId}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.name).toBe('Bryan Cranston');
    expect(typeof b.imdbId).toBe('string');
    const filmography = b.filmography as Record<string, unknown>[];
    expect(Array.isArray(filmography)).toBe(true);
    const breakingBad = filmography.find((f) => f.title === 'Breaking Bad');
    expect(breakingBad).toBeDefined();
    expect(breakingBad?.character).toBe('Walter White');
    expect(breakingBad?.type).toBe('series');
    expect(typeof breakingBad?.ord).toBe('number');
    expect(typeof breakingBad?.rating).toBe('number');
  });

  it('returns 404 for unknown id', async () => {
    const { status, body } = await request('/api/people/999999');
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });
});
