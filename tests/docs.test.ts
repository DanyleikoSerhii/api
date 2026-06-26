import { describe, it, expect } from 'vitest';
import { request } from './helpers/request.js';

describe('GET /api/docs', () => {
  it('serves Swagger UI HTML wired to the OpenAPI document', async () => {
    const { status, body } = await request('/api/docs');
    expect(status).toBe(200);
    expect(body as string).toContain('/api/openapi.json');
  });

  it('is a pure static asset — no DB access, no auth cookie', async () => {
    // The handler used to mint a system-user JWT per request (a DB round-trip),
    // which could crash the serverless function on the managed prod DB. It now
    // serves the Swagger UI statically; "Try it out" works once you log in via
    // POST /api/auth/login (same-origin cookie). So no cookie is set here.
    const { status, cookies } = await request('/api/docs');
    expect(status).toBe(200);
    expect(cookies.token).toBeUndefined();
  });
});
