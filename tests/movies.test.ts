import { describe, it, expect } from 'vitest';
import { request } from './helpers/request.js';

describe('GET /api/movies', () => {
  it('returns paginated list', async () => {
    const { status, body } = await request('/api/movies');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(Array.isArray(b.data)).toBe(true);
    const pagination = b.pagination as Record<string, number>;
    expect(pagination.page).toBe(1);
    expect(pagination.total).toBeGreaterThan(0);
  });

  it('filters by type=movie returns only movies', async () => {
    const { body } = await request('/api/movies?type=movie');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('movie');
    }
  });

  it('filters by type=series returns only series', async () => {
    const { body } = await request('/api/movies?type=series');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('series');
    }
  });

  it('filters by year', async () => {
    const { body } = await request('/api/movies?year=1994');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.year).toBe(1994);
    }
  });

  it('filters by genre', async () => {
    const { body } = await request('/api/movies?genre=Crime');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect((item.genres as string[]).some((g) => g.toLowerCase() === 'crime')).toBe(true);
    }
  });

  it('searches by title via q', async () => {
    const { body } = await request('/api/movies?q=Breaking');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.some((t) => (t.title as string).includes('Breaking'))).toBe(true);
  });

  it('searches by director name via q', async () => {
    const { body } = await request('/api/movies?q=Gilligan');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.some((t) => t.title === 'Breaking Bad' || t.title === 'The Wire')).toBe(true);
  });

  it('searches by actor name via q', async () => {
    // Bryan Cranston is in Breaking Bad cast (seeded)
    const { body } = await request('/api/movies?q=Cranston');
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.some((t) => t.title === 'Breaking Bad')).toBe(true);
  });

  it('rejects limit above 100 with 400', async () => {
    const { status } = await request('/api/movies?limit=500');
    expect(status).toBe(400);
  });

  it('paginates correctly', async () => {
    const { body } = await request('/api/movies?page=1&limit=2');
    const pagination = (body as Record<string, unknown>).pagination as Record<string, number>;
    expect(pagination.page).toBe(1);
    expect(pagination.limit).toBe(2);
    const data = (body as Record<string, unknown>).data as unknown[];
    expect(data.length).toBeLessThanOrEqual(2);
  });
});

describe('GET /api/movies/:id', () => {
  it('returns movie detail with null series fields', async () => {
    const listRes = await request('/api/movies?type=movie&limit=1');
    const movieId = (
      (listRes.body as Record<string, unknown>).data as Record<string, unknown>[]
    )[0]?.['id'] as number;

    const { status, body } = await request(`/api/movies/${movieId}`);
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
    const listRes = await request('/api/movies?type=series&q=Breaking&limit=1');
    const data = (listRes.body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    const seriesId = data[0]?.['id'] as number;

    const { status, body } = await request(`/api/movies/${seriesId}`);
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
    const { status, body } = await request('/api/movies/999999');
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });

  it('returns isFavorite: false when not authenticated', async () => {
    const listRes = await request('/api/movies?limit=1');
    const titleId = (
      (listRes.body as Record<string, unknown>).data as Record<string, unknown>[]
    )[0]?.['id'] as number;
    const { body } = await request(`/api/movies/${titleId}`);
    expect((body as Record<string, unknown>).isFavorite).toBe(false);
  });
});

const dataOf = (body: unknown) =>
  (body as Record<string, unknown>).data as Record<string, unknown>[];

describe('GET /api/movies sorting and advanced filters', () => {
  it('sort=year&order=asc returns ascending years', async () => {
    const { status, body } = await request('/api/movies?sort=year&order=asc&limit=100');
    expect(status).toBe(200);
    const years = dataOf(body).map((t) => t.year as number);
    expect(years.length).toBeGreaterThan(1);
    const sorted = [...years].sort((a, b) => a - b);
    expect(years).toEqual(sorted);
  });

  it('sort=numVotes&order=desc orders by votes descending', async () => {
    const { status, body } = await request('/api/movies?sort=numVotes&order=desc&limit=100');
    expect(status).toBe(200);
    const votes = dataOf(body).map((t) => t.numVotes as number);
    expect(votes.length).toBeGreaterThan(1);
    const sorted = [...votes].sort((a, b) => b - a);
    expect(votes).toEqual(sorted);
  });

  it('yearFrom/yearTo filters by range', async () => {
    const { status, body } = await request('/api/movies?yearFrom=1990&yearTo=2000&limit=100');
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
    const { status, body } = await request('/api/movies?minRating=9.3&limit=100');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.rating as number).toBeGreaterThanOrEqual(9.3);
    }
  });

  it('minVotes filters by vote count', async () => {
    const { status, body } = await request('/api/movies?minVotes=2000000&limit=100');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.numVotes as number).toBeGreaterThanOrEqual(2000000);
    }
  });

  it('genres with genreMode=all returns only titles having every listed genre', async () => {
    const { status, body } = await request(
      '/api/movies?genres=Drama,Crime&genreMode=all&limit=100',
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
    const allRes = await request('/api/movies?genres=Drama,Crime&genreMode=all&limit=100');
    const anyRes = await request('/api/movies?genres=Drama,Crime&genreMode=any&limit=100');
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
    const { body } = await request('/api/movies?limit=1');
    const item = dataOf(body)[0];
    expect(typeof item.numVotes).toBe('number');
  });
});

describe('GET /api/movies/:id/similar', () => {
  it('returns related titles, excludes the title itself, respects limit', async () => {
    const listRes = await request('/api/movies?q=Shawshank&limit=1');
    const target = dataOf(listRes.body)[0];
    const targetId = target.id as number;

    const { status, body } = await request(`/api/movies/${targetId}/similar?limit=3`);
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
    const { status, body } = await request('/api/movies/999999/similar');
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/movies/:id trailer & backdrop', () => {
  it('derives trailerUrl from the stored trailer key and returns backdropUrl', async () => {
    // Breaking Bad is seeded with a trailerKey and backdropUrl.
    const listRes = await request('/api/movies?q=Breaking&type=series&limit=1');
    const id = dataOf(listRes.body)[0].id as number;

    const { status, body } = await request(`/api/movies/${id}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.trailerUrl).toBe('https://www.youtube.com/watch?v=HhesaQXLuRY');
    expect(b.backdropUrl).toBe('https://image.tmdb.org/t/p/w1280/bb.jpg');
  });

  it('returns null trailerUrl/backdropUrl for a title without enrichment', async () => {
    const listRes = await request('/api/movies?q=Shawshank&limit=1');
    const id = dataOf(listRes.body)[0].id as number;

    const { body } = await request(`/api/movies/${id}`);
    const b = body as Record<string, unknown>;
    expect(b.trailerUrl).toBeNull();
    expect(b.backdropUrl).toBeNull();
  });
});

describe('GET /api/movies/popular', () => {
  it('returns titles sorted by rating desc then numVotes desc', async () => {
    const { status, body } = await request('/api/movies/popular?limit=7');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    const ratings = data.map((t) => t.rating as number);
    const sorted = [...ratings].sort((a, b) => b - a);
    expect(ratings).toEqual(sorted);
  });

  it('respects type=movie filter', async () => {
    const { status, body } = await request('/api/movies/popular?type=movie');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('movie');
    }
  });

  it('respects type=series filter', async () => {
    const { status, body } = await request('/api/movies/popular?type=series');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('series');
    }
  });

  it('respects limit param', async () => {
    const { status, body } = await request('/api/movies/popular?limit=2');
    expect(status).toBe(200);
    expect(dataOf(body).length).toBeLessThanOrEqual(2);
  });

  it('rejects limit above 50 with 400', async () => {
    const { status } = await request('/api/movies/popular?limit=51');
    expect(status).toBe(400);
  });

  it('includes pagination', async () => {
    const { body } = await request('/api/movies/popular');
    const pagination = (body as Record<string, unknown>).pagination as Record<string, number>;
    expect(pagination.page).toBe(1);
    expect(pagination.total).toBeGreaterThan(0);
  });
});

describe('GET /api/movies/banners', () => {
  it('only returns titles with a backdropUrl', async () => {
    const { status, body } = await request('/api/movies/banners');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(typeof item.backdropUrl).toBe('string');
      expect((item.backdropUrl as string).length).toBeGreaterThan(0);
    }
  });

  it('includes the seeded Breaking Bad banner', async () => {
    const { body } = await request('/api/movies/banners');
    const data = dataOf(body);
    expect(data.some((t) => t.title === 'Breaking Bad')).toBe(true);
  });

  it('respects type=movie filter (no seeded movie has a backdrop)', async () => {
    const { status, body } = await request('/api/movies/banners?type=movie');
    expect(status).toBe(200);
    expect(dataOf(body)).toHaveLength(0);
  });

  it('respects type=series filter', async () => {
    const { status, body } = await request('/api/movies/banners?type=series');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('series');
    }
  });

  it('rejects limit above 20 with 400', async () => {
    const { status } = await request('/api/movies/banners?limit=21');
    expect(status).toBe(400);
  });
});

describe('GET /api/movies/autocomplete', () => {
  it('returns matching titles for q=Break', async () => {
    const { status, body } = await request('/api/movies/autocomplete?q=Break');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(typeof item.id).toBe('number');
      expect(typeof item.title).toBe('string');
      expect(typeof item.year).toBe('number');
      expect(['movie', 'series']).toContain(item.type);
    }
  });

  it('prefix matches rank before substring matches', async () => {
    // "Breaking Bad" starts with "Break" — should come before any title that only contains it mid-word
    const { body } = await request('/api/movies/autocomplete?q=The');
    const data = dataOf(body);
    // All seeded titles with "The" at start should precede those with "The" mid-string
    const titles = data.map((t) => t.title as string);
    const prefixMatches = titles.filter((t) => t.toLowerCase().startsWith('the'));
    const substringOnly = titles.filter((t) => !t.toLowerCase().startsWith('the'));
    // prefix matches should appear before substring-only matches
    if (prefixMatches.length > 0 && substringOnly.length > 0) {
      const lastPrefix = titles.lastIndexOf(prefixMatches[prefixMatches.length - 1]);
      const firstSubstring = titles.indexOf(substringOnly[0]);
      expect(lastPrefix).toBeLessThan(firstSubstring);
    }
  });

  it('filters by type', async () => {
    const { status, body } = await request('/api/movies/autocomplete?q=Break&type=series');
    expect(status).toBe(200);
    const data = dataOf(body);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      expect(item.type).toBe('series');
    }
  });

  it('respects limit param', async () => {
    const { status, body } = await request('/api/movies/autocomplete?q=t&limit=2');
    expect(status).toBe(200);
    expect(dataOf(body).length).toBeLessThanOrEqual(2);
  });

  it('returns 400 without q', async () => {
    const { status } = await request('/api/movies/autocomplete');
    expect(status).toBe(400);
  });

  it('returns 400 for limit above 20', async () => {
    const { status } = await request('/api/movies/autocomplete?q=a&limit=21');
    expect(status).toBe(400);
  });
});
