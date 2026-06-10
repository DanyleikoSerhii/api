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
});
