import { describe, it, expect } from 'vitest';
import { request } from './helpers/request.js';

describe('GET /api/genres', () => {
  it('returns alphabetically sorted list', async () => {
    const { status, body } = await request('/api/genres');
    expect(status).toBe(200);
    const data = (body as Record<string, unknown>).data as string[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const sorted = [...data].sort();
    expect(data).toEqual(sorted);
  });

  it('includes seeded genres', async () => {
    const { body } = await request('/api/genres');
    const data = (body as Record<string, unknown>).data as string[];
    expect(data).toContain('Drama');
    expect(data).toContain('Crime');
  });

  it('filters by q returns matching genres', async () => {
    const { status, body } = await request('/api/genres?q=dra');
    expect(status).toBe(200);
    const data = (body as Record<string, unknown>).data as string[];
    expect(data).toContain('Drama');
    expect(data).not.toContain('Crime');
    expect(data).not.toContain('Action');
  });

  it('q is case-insensitive', async () => {
    const { body: lower } = await request('/api/genres?q=drama');
    const { body: upper } = await request('/api/genres?q=DRAMA');
    const lData = (lower as Record<string, unknown>).data as string[];
    const uData = (upper as Record<string, unknown>).data as string[];
    expect(lData).toEqual(uData);
    expect(lData).toContain('Drama');
  });

  it('returns empty array for unmatched q', async () => {
    const { status, body } = await request('/api/genres?q=zzznonexistent');
    expect(status).toBe(200);
    const data = (body as Record<string, unknown>).data as string[];
    expect(data.length).toBe(0);
  });
});
