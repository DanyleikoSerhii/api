import { describe, it, expect } from 'vitest';
import { request } from './helpers/request.js';

describe('GET /health', () => {
  it('returns 200 with db up', async () => {
    const { status, body } = await request('/health');
    expect(status).toBe(200);
    const b = body as Record<string, string>;
    expect(b.status).toBe('ok');
    expect(b.db).toBe('up');
  });
});
