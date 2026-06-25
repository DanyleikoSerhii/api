import { describe, it, expect } from 'vitest';
import { request, authCookie } from './helpers/request.js';
import { verifyToken } from '../src/lib/jwt.js';
import { SYSTEM_USER_EMAIL } from '../src/lib/systemUser.js';
import { env } from '../src/env.js';

describe('GET /api/docs', () => {
  it('serves Swagger UI HTML wired to the OpenAPI document', async () => {
    const { status, body } = await request('/api/docs');
    expect(status).toBe(200);
    expect(body as string).toContain('/api/openapi.json');
  });

  it('sets a valid system-user auth cookie that authenticates /api/auth/me', async () => {
    const { cookies } = await request('/api/docs');
    const token = cookies.token;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const payload = await verifyToken(token, env.JWT_SECRET);
    expect(payload.email).toBe(SYSTEM_USER_EMAIL);

    const { status, body: me } = await request('/api/auth/me', {
      headers: authCookie(token),
    });
    expect(status).toBe(200);
    expect((me as Record<string, unknown>).email).toBe(SYSTEM_USER_EMAIL);
  });
});
