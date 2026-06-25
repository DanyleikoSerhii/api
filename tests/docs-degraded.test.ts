import { vi, describe, it, expect } from 'vitest';

// Simulate the DB being unreachable when provisioning the system-user token.
vi.mock('../src/lib/systemUser.js', () => ({
  SYSTEM_USER_EMAIL: 'system@movie-explorer.local',
  ensureSystemUser: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
  getSystemUserToken: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
}));

const { request } = await import('./helpers/request.js');

describe('GET /api/docs when the system user cannot be provisioned', () => {
  it('still serves Swagger UI (200) without an auth cookie', async () => {
    const { status, body, cookies } = await request('/api/docs');
    expect(status).toBe(200);
    expect(body as string).toContain('/api/openapi.json');
    expect(cookies.token).toBeUndefined();
  });
});
