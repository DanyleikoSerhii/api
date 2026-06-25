import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from './helpers/db.js';
import { request, authCookie } from './helpers/request.js';

async function registerAndGetToken(email = 'favuser@example.com'): Promise<string> {
  const { cookies } = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'secret123' },
  });
  return cookies.token;
}

async function getFirstTitleId(): Promise<number> {
  const { body } = await request('/api/movies?limit=1');
  return ((body as Record<string, unknown>).data as Record<string, unknown>[])[0].id as number;
}

beforeEach(async () => {
  await truncateAll();
});

describe('POST /api/favorites/:titleId', () => {
  it('returns 401 without token', async () => {
    const titleId = await getFirstTitleId();
    const { status } = await request(`/api/favorites/${titleId}`, { method: 'POST' });
    expect(status).toBe(401);
  });

  it('adds favorite and returns 201', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    const { status, body } = await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: authCookie(token),
    });
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(b.id).toBe(titleId);
    expect(typeof b.addedAt).toBe('string');
  });

  it('returns 409 when already in favorites', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: authCookie(token),
    });
    const { status, body } = await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: authCookie(token),
    });
    expect(status).toBe(409);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('CONFLICT');
  });

  it('returns 404 for non-existent title', async () => {
    const token = await registerAndGetToken();
    const { status, body } = await request('/api/favorites/999999', {
      method: 'POST',
      headers: authCookie(token),
    });
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/favorites', () => {
  it('returns 401 without token', async () => {
    const { status } = await request('/api/favorites');
    expect(status).toBe(401);
  });

  it('returns empty list initially', async () => {
    const token = await registerAndGetToken();
    const { status, body } = await request('/api/favorites', {
      headers: authCookie(token),
    });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect((b.data as unknown[]).length).toBe(0);
    expect((b.pagination as Record<string, number>).total).toBe(0);
  });

  it('returns favorites after adding', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: authCookie(token),
    });
    const { body } = await request('/api/favorites', {
      headers: authCookie(token),
    });
    const b = body as Record<string, unknown>;
    expect((b.data as unknown[]).length).toBe(1);
    expect((b.pagination as Record<string, number>).total).toBe(1);
  });

  it('searches favorites by title via q', async () => {
    const token = await registerAndGetToken();

    // Add all seeded titles to favorites
    const { body: list } = await request('/api/movies?limit=100');
    const allIds = ((list as Record<string, unknown>).data as Record<string, unknown>[]).map(
      (t) => t.id as number,
    );
    for (const id of allIds) {
      await request(`/api/favorites/${id}`, {
        method: 'POST',
        headers: authCookie(token),
      });
    }

    const { status, body } = await request('/api/favorites?q=Breaking', {
      headers: authCookie(token),
    });
    expect(status).toBe(200);
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.length).toBeGreaterThan(0);
    expect(data.some((t) => (t.title as string).includes('Breaking'))).toBe(true);
  });

  it('searches favorites by actor name via q', async () => {
    const token = await registerAndGetToken();
    // Breaking Bad has Bryan Cranston in cast (seeded)
    const { body: list } = await request('/api/movies?q=Breaking&limit=1');
    const bbId = ((list as Record<string, unknown>).data as Record<string, unknown>[])[0]
      .id as number;
    await request(`/api/favorites/${bbId}`, {
      method: 'POST',
      headers: authCookie(token),
    });

    const { status, body } = await request('/api/favorites?q=Cranston', {
      headers: authCookie(token),
    });
    expect(status).toBe(200);
    const data = (body as Record<string, unknown>).data as Record<string, unknown>[];
    expect(data.some((t) => t.title === 'Breaking Bad')).toBe(true);
  });

  it('sorts favorites by year ascending', async () => {
    const token = await registerAndGetToken();
    const { body: list } = await request('/api/movies?limit=100');
    const allIds = ((list as Record<string, unknown>).data as Record<string, unknown>[]).map(
      (t) => t.id as number,
    );
    for (const id of allIds) {
      await request(`/api/favorites/${id}`, {
        method: 'POST',
        headers: authCookie(token),
      });
    }

    const { status, body } = await request('/api/favorites?sort=year&order=asc', {
      headers: authCookie(token),
    });
    expect(status).toBe(200);
    const years = ((body as Record<string, unknown>).data as Record<string, unknown>[]).map(
      (t) => t.year as number,
    );
    expect(years.length).toBeGreaterThan(1);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it('includes numVotes in response', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: authCookie(token),
    });
    const { body } = await request('/api/favorites', {
      headers: authCookie(token),
    });
    const item = ((body as Record<string, unknown>).data as Record<string, unknown>[])[0];
    expect(typeof item.numVotes).toBe('number');
  });
});

describe('DELETE /api/favorites/:titleId', () => {
  it('returns 401 without token', async () => {
    const titleId = await getFirstTitleId();
    const { status } = await request(`/api/favorites/${titleId}`, { method: 'DELETE' });
    expect(status).toBe(401);
  });

  it('deletes favorite and returns 204', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: authCookie(token),
    });
    const { status } = await request(`/api/favorites/${titleId}`, {
      method: 'DELETE',
      headers: authCookie(token),
    });
    expect(status).toBe(204);
  });

  it('returns 404 when not in favorites', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    const { status, body } = await request(`/api/favorites/${titleId}`, {
      method: 'DELETE',
      headers: authCookie(token),
    });
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/favorites/check', () => {
  it('returns 401 without token', async () => {
    const { status } = await request('/api/favorites/check', {
      method: 'POST',
      body: { ids: [1] },
    });
    expect(status).toBe(401);
  });

  it('returns correct isFavorite map', async () => {
    const token = await registerAndGetToken();
    const { body: list } = await request('/api/movies?limit=2');
    const ids = ((list as Record<string, unknown>).data as Record<string, unknown>[]).map(
      (t) => t.id as number,
    );
    const [id0, id1] = ids;

    // Add only the first to favorites
    await request(`/api/favorites/${id0}`, {
      method: 'POST',
      headers: authCookie(token),
    });

    const { status, body } = await request('/api/favorites/check', {
      method: 'POST',
      headers: authCookie(token),
      body: { ids: [id0, id1] },
    });
    expect(status).toBe(200);

    const data = (body as Record<string, unknown>).data as {
      id: number;
      isFavorite: boolean;
    }[];
    const entry0 = data.find((e) => e.id === id0);
    const entry1 = data.find((e) => e.id === id1);
    expect(entry0?.isFavorite).toBe(true);
    expect(entry1?.isFavorite).toBe(false);
  });

  it('returns 400 on empty titleIds', async () => {
    const token = await registerAndGetToken();
    const { status, body } = await request('/api/favorites/check', {
      method: 'POST',
      headers: authCookie(token),
      body: { ids: [] },
    });
    expect(status).toBe(400);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('isFavorite integration', () => {
  it('reflects true after adding and false after removing', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();

    // Before adding — false
    const { body: before } = await request(`/api/movies/${titleId}`, {
      headers: authCookie(token),
    });
    expect((before as Record<string, unknown>).isFavorite).toBe(false);

    // Add favorite
    await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: authCookie(token),
    });

    // After adding — true
    const { body: after } = await request(`/api/movies/${titleId}`, {
      headers: authCookie(token),
    });
    expect((after as Record<string, unknown>).isFavorite).toBe(true);

    // Remove favorite
    await request(`/api/favorites/${titleId}`, {
      method: 'DELETE',
      headers: authCookie(token),
    });

    // After removing — false
    const { body: final } = await request(`/api/movies/${titleId}`, {
      headers: authCookie(token),
    });
    expect((final as Record<string, unknown>).isFavorite).toBe(false);
  });
});
