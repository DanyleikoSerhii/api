import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from './helpers/db.js';
import { request } from './helpers/request.js';

async function registerAndGetToken(email = 'favuser@example.com'): Promise<string> {
  const { body } = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'secret123' },
  });
  return (body as Record<string, string>).token;
}

async function getFirstTitleId(): Promise<number> {
  const { body } = await request('/api/titles?limit=1');
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
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(b.titleId).toBe(titleId);
    expect(typeof b.addedAt).toBe('string');
  });

  it('returns 409 when already in favorites', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const { status, body } = await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(409);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('CONFLICT');
  });

  it('returns 404 for non-existent title', async () => {
    const token = await registerAndGetToken();
    const { status, body } = await request('/api/favorites/999999', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
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
      headers: { Authorization: `Bearer ${token}` },
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
      headers: { Authorization: `Bearer ${token}` },
    });
    const { body } = await request('/api/favorites', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const b = body as Record<string, unknown>;
    expect((b.data as unknown[]).length).toBe(1);
    expect((b.pagination as Record<string, number>).total).toBe(1);
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
      headers: { Authorization: `Bearer ${token}` },
    });
    const { status } = await request(`/api/favorites/${titleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(204);
  });

  it('returns 404 when not in favorites', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();
    const { status, body } = await request(`/api/favorites/${titleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(404);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('NOT_FOUND');
  });
});

describe('isFavorite integration', () => {
  it('reflects true after adding and false after removing', async () => {
    const token = await registerAndGetToken();
    const titleId = await getFirstTitleId();

    // Before adding — false
    const { body: before } = await request(`/api/titles/${titleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((before as Record<string, unknown>).isFavorite).toBe(false);

    // Add favorite
    await request(`/api/favorites/${titleId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    // After adding — true
    const { body: after } = await request(`/api/titles/${titleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((after as Record<string, unknown>).isFavorite).toBe(true);

    // Remove favorite
    await request(`/api/favorites/${titleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    // After removing — false
    const { body: final } = await request(`/api/titles/${titleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((final as Record<string, unknown>).isFavorite).toBe(false);
  });
});
