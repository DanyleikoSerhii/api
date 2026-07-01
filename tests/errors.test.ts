import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from './helpers/db.js';
import { request } from './helpers/request.js';

beforeEach(async () => {
  await truncateAll();
});

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

describe('unified error envelope', () => {
  it('returns a NOT_FOUND envelope for unknown routes (not plain text)', async () => {
    const { status, body } = await request('/api/does-not-exist');
    expect(status).toBe(404);
    expect((body as ErrorBody).error.code).toBe('NOT_FOUND');
    expect(typeof (body as ErrorBody).error.message).toBe('string');
  });

  it('returns a VALIDATION_ERROR message summarizing every invalid field, not a generic string', async () => {
    const { status, body } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'not-an-email' },
    });
    expect(status).toBe(400);
    const err = (body as ErrorBody).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe(
      'email: Invalid email address; password: Invalid input: expected string, received undefined',
    );
    expect(Array.isArray(err.details)).toBe(true);
  });

  it('returns a RATE_LIMITED envelope once the auth limit is exceeded', async () => {
    const attempt = () =>
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'nobody@example.com', password: 'secret123' },
      });

    // 10 requests are allowed per window; the 11th is rejected.
    let last = await attempt();
    for (let i = 0; i < 10; i++) last = await attempt();

    expect(last.status).toBe(429);
    expect((last.body as ErrorBody).error.code).toBe('RATE_LIMITED');
  });
});
