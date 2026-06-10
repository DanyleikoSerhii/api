import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from './helpers/db.js';
import { request } from './helpers/request.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { signToken, verifyToken } from '../src/lib/jwt.js';

beforeEach(async () => {
  await truncateAll();
});

describe('password utils', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('secret123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('jwt utils', () => {
  it('signs and verifies token', async () => {
    const secret = 'test-secret';
    const token = await signToken(42, 'test@example.com', secret);
    const payload = await verifyToken(token, secret);
    expect(payload.sub).toBe(42);
    expect(payload.email).toBe('test@example.com');
  });
});

describe('POST /api/auth/register', () => {
  it('returns 201 with token and user', async () => {
    const { status, body } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'newuser@example.com', password: 'secret123' },
    });
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(typeof b.token).toBe('string');
    expect((b.user as Record<string, unknown>).email).toBe('newuser@example.com');
  });

  it('returns 409 on duplicate email', async () => {
    await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'dup@example.com', password: 'secret123' },
    });
    const { status, body } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'dup@example.com', password: 'secret123' },
    });
    expect(status).toBe(409);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('CONFLICT');
  });

  it('returns 400 on invalid body', async () => {
    const { status } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'notanemail', password: '' },
    });
    expect(status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'login@example.com', password: 'secret123' },
    });
  });

  it('returns 200 with token on valid credentials', async () => {
    const { status, body } = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'login@example.com', password: 'secret123' },
    });
    expect(status).toBe(200);
    expect(typeof (body as Record<string, unknown>).token).toBe('string');
  });

  it('returns 401 on wrong password', async () => {
    const { status, body } = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'login@example.com', password: 'wrongpassword' },
    });
    expect(status).toBe(401);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on unknown email', async () => {
    const { status } = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.com', password: 'secret123' },
    });
    expect(status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  let token: string;

  beforeEach(async () => {
    const { body } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'me@example.com', password: 'secret123' },
    });
    token = (body as Record<string, string>).token;
  });

  it('returns 200 with user data when authenticated', async () => {
    const { status, body } = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).email).toBe('me@example.com');
  });

  it('returns 401 without token', async () => {
    const { status } = await request('/api/auth/me');
    expect(status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const { status } = await request('/api/auth/me', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    expect(status).toBe(401);
  });
});
