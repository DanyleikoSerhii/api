import { describe, it, expect } from 'vitest';
import { request } from './helpers/request.js';

describe('GET /api/titles', () => {
  it('returns paginated list', async () => {
    const { status, body } = await request('/api/titles');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(Array.isArray(b.data)).toBe(true);
    const pagination = b.pagination as Record<string, number>;
    expect(pagination.page).toBe(1);
    expect(pagination.total).toBeGreaterThan(0);
  });

  it('filters by type=movie returns only movies', async () => {
    const { body } = await request('/api/titles?type=movie');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('movie');
    }
  });

  it('filters by type=series returns only series', async () => {
    const { body } = await request('/api/titles?type=series');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('series');
    }
  });

  it('filters by year', async () => {
    const { body } = await request('/api/titles?year=1994');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.year).toBe(1994);
    }
  });

  it('filters by genre', async () => {
    const { body } = await request('/api/titles?genre=Crime');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect((item.genres as string[]).some((g) => g.toLowerCase() === 'crime')).toBe(true);
    }
  });

  it('searches by q', async () => {
    const { body } = await request('/api/titles?q=Breaking');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.some((t) => (t.title as string).includes('Breaking'))).toBe(true);
  });

  it('rejects limit above 100 with 400', async () => {
    const { status } = await request('/api/titles?limit=500');
    expect(status).toBe(400);
  });

  it('paginates correctly', async () => {
    const { body } = await request('/api/titles?page=1&limit=2');
    const pagination = (body as Record<string, unknown>).pagination as Record<string, number>;
    expect(pagination.page).toBe(1);
    expect(pagination.limit).toBe(2);
    const data = (body as Record<string, unknown>).data as unknown[];
    expect(data.length).toBeLessThanOrEqual(2);
  });
});

describe('GET /api/titles/:id', () => {
  it('returns movie detail with null series fields', async () => {
    const listRes = await request('/api/titles?type=movie&limit=1');
    const movieId = (
      (listRes.body as Record<string, unknown>).data as Record<string, unknown>[]
    )[0]?.['id'] as number;

    const { status, body } = await request(`/api/titles/${movieId}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.type).toBe('movie');
    expect(b.seasonsCount).toBeNull();
    expect(b.endYear).toBeNull();
    expect(b.isFavorite).toBe(false);
    expect(Array.isArray(b.genres)).toBe(true);
    expect(Array.isArray(b.cast)).toBe(true);
  });

  it('returns series detail with seasons/episodes/cast', async () => {
    const listRes = await request('/api/titles?type=series&q=Breaking&limit=1');
    const data = (listRes.body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    const seriesId = data[0]?.['id'] as number;

    const { status, body } = await request(`/api/titles/${seriesId}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.type).toBe('series');
    expect(b.seasonsCount).not.toBeNull();
    expect(b.episodesCount).not.toBeNull();
    const cast = b.cast as Record<string, unknown>[];
    expect(cast.length).toBeGreaterThan(0);
    expect(typeof cast[0].name).toBe('string');
  });

  it('returns 404 for unknown id', async () => {
    const { status, body } = await request('/api/titles/999999');
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });

  it('returns isFavorite: false when not authenticated', async () => {
    const listRes = await request('/api/titles?limit=1');
    const titleId = (
      (listRes.body as Record<string, unknown>).data as Record<string, unknown>[]
    )[0]?.['id'] as number;
    const { body } = await request(`/api/titles/${titleId}`);
    expect((body as Record<string, unknown>).isFavorite).toBe(false);
  });
});

const dataOf = (body: unknown) =>
  (body as Record<string, unknown>).data as Record<string, unknown>[];

describe('GET /api/titles sorting and advanced filters', () => {
  it('sort=year&order=asc returns ascending years', async () => {
    const { status, body } = await request('/api/titles?sort=year&order=asc&limit=100');
    expect(status).toBe(200);
    const years = dataOf(body).map((t) => t.year as number);
    expect(years.length).toBeGreaterThan(1);
    const sorted = [...years].sort((a, b) => a - b);
    expect(years).toEqual(sorted);
  });

  it('sort=numVotes&order=desc orders by votes descending', async () => {
    const { status, body } = await request('/api/titles?sort=numVotes&order=desc&limit=100');
    expect(status).toBe(200);
    const votes = dataOf(body).map((t) => t.numVotes as number);
    expect(votes.length).toBeGreaterThan(1);
    const sorted = [...votes].sort((a, b) => b - a);
    expect(votes).toEqual(sorted);
  });

  it('yearFrom/yearTo filters by range', async () => {
    const { status, body } = await request('/api/titles?yearFrom=1990&yearTo=2000&limit=100');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      const y = item.year as number;
      expect(y).toBeGreaterThanOrEqual(1990);
      expect(y).toBeLessThanOrEqual(2000);
    }
  });

  it('minRating only returns titles with rating >= minRating', async () => {
    const { status, body } = await request('/api/titles?minRating=9.3&limit=100');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.rating as number).toBeGreaterThanOrEqual(9.3);
    }
  });

  it('minVotes filters by vote count', async () => {
    const { status, body } = await request('/api/titles?minVotes=2000000&limit=100');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.numVotes as number).toBeGreaterThanOrEqual(2000000);
    }
  });

  it('genres with genreMode=all returns only titles having every listed genre', async () => {
    const { status, body } = await request(
      '/api/titles?genres=Drama,Crime&genreMode=all&limit=100',
    );
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      const g = (item.genres as string[]).map((x) => x.toLowerCase());
      expect(g).toContain('drama');
      expect(g).toContain('crime');
    }
  });

  it('genres with genreMode=any returns titles having either genre', async () => {
    const allRes = await request('/api/titles?genres=Drama,Crime&genreMode=all&limit=100');
    const anyRes = await request('/api/titles?genres=Drama,Crime&genreMode=any&limit=100');
    expect(anyRes.status).toBe(200);
    const anyData = dataOf(anyRes.body);
    expect(anyData.length).toBeGreaterThan(0);
    for (const item of anyData) {
      const g = (item.genres as string[]).map((x) => x.toLowerCase());
      expect(g.includes('drama') || g.includes('crime')).toBe(true);
    }
    // 'any' must be a superset of 'all'.
    expect(anyData.length).toBeGreaterThanOrEqual(dataOf(allRes.body).length);
  });

  it('list items include numeric numVotes', async () => {
    const { body } = await request('/api/titles?limit=1');
    const item = dataOf(body)[0];
    expect(typeof item.numVotes).toBe('number');
  });
});

describe('GET /api/titles/:id/similar', () => {
  it('returns related titles, excludes the title itself, respects limit', async () => {
    const listRes = await request('/api/titles?q=Shawshank&limit=1');
    const target = dataOf(listRes.body)[0];
    const targetId = target.id as number;

    const { status, body } = await request(`/api/titles/${targetId}/similar?limit=3`);
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThanOrEqual(3);
    for (const item of data) {
      expect(item.id).not.toBe(targetId);
      // Shawshank is Drama/Crime — similar titles share at least one genre.
      const g = (item.genres as string[]).map((x) => x.toLowerCase());
      expect(g.includes('drama') || g.includes('crime')).toBe(true);
      expect(typeof item.numVotes).toBe('number');
    }
  });

  it('returns 404 for a non-existent id', async () => {
    const { status, body } = await request('/api/titles/999999/similar');
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });
});
