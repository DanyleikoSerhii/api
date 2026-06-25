import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from './helpers/db.js';
import { request, authCookie } from './helpers/request.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { signToken, verifyToken } from '../src/lib/jwt.js';
import { sign } from 'hono/jwt';

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
  it('returns 201 with user and sets auth cookie', async () => {
    const { status, body, cookies } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'newuser@example.com', password: 'secret123' },
    });
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(b.token).toBeUndefined();
    expect((b.user as Record<string, unknown>).email).toBe('newuser@example.com');
    expect(typeof cookies.token).toBe('string');
    expect(cookies.token.length).toBeGreaterThan(0);
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

  it('returns 200 and sets auth cookie on valid credentials', async () => {
    const { status, body, cookies } = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'login@example.com', password: 'secret123' },
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).token).toBeUndefined();
    expect(typeof cookies.token).toBe('string');
    expect(cookies.token.length).toBeGreaterThan(0);
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

describe('POST /api/auth/logout', () => {
  it('returns 204 and clears the auth cookie', async () => {
    const { cookies } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'logout@example.com', password: 'secret123' },
    });
    const { status, cookies: cleared } = await request('/api/auth/logout', {
      method: 'POST',
      headers: authCookie(cookies.token),
    });
    expect(status).toBe(204);
    // deleteCookie emits a token cookie with an empty value to overwrite it.
    expect(cleared.token).toBe('');
  });

  it('returns 204 even without a cookie (idempotent)', async () => {
    const { status } = await request('/api/auth/logout', { method: 'POST' });
    expect(status).toBe(204);
  });
});

describe('GET /api/auth/me', () => {
  let token: string;

  beforeEach(async () => {
    const { cookies } = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'me@example.com', password: 'secret123' },
    });
    token = cookies.token;
  });

  it('returns 200 with user data when authenticated via cookie', async () => {
    const { status, body } = await request('/api/auth/me', {
      headers: authCookie(token),
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).email).toBe('me@example.com');
  });

  it('returns 401 without cookie', async () => {
    const { status } = await request('/api/auth/me');
    expect(status).toBe(401);
  });

  it('returns 401 with invalid cookie', async () => {
    const { status } = await request('/api/auth/me', {
      headers: authCookie('invalid.token.here'),
    });
    expect(status).toBe(401);
  });

  it('ignores a Bearer header (cookie-only auth)', async () => {
    const { status } = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(401);
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const forged = await signToken(
      1,
      'me@example.com',
      'a-different-secret-at-least-32-chars-long',
    );
    const { status } = await request('/api/auth/me', {
      headers: authCookie(forged),
    });
    expect(status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    // hono/jwt rejects tokens whose exp is in the past.
    const expired = await sign(
      { sub: 1, email: 'me@example.com', exp: 1 },
      process.env.JWT_SECRET!,
    );
    const { status } = await request('/api/auth/me', {
      headers: authCookie(expired),
    });
    expect(status).toBe(401);
  });
});

async function registerUser(email: string): Promise<string> {
  const { cookies } = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'secret123' },
  });
  return cookies.token;
}

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('GET /api/auth/me profile fields', () => {
  it('returns profile fields as null for a fresh account', async () => {
    const token = await registerUser('fresh@example.com');
    const { status, body } = await request('/api/auth/me', {
      headers: authCookie(token),
    });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.nickname).toBeNull();
    expect(b.firstName).toBeNull();
    expect(b.lastName).toBeNull();
    expect(b.avatar).toBeNull();
  });
});

describe('PATCH /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const { status } = await request('/api/auth/me', {
      method: 'PATCH',
      body: { nickname: 'whoever' },
    });
    expect(status).toBe(401);
  });

  it('updates profile fields and reflects them in GET /me', async () => {
    const token = await registerUser('profile@example.com');
    const { status, body } = await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(token),
      body: { nickname: 'Ada_Lovelace', firstName: 'Ada', lastName: 'Lovelace', avatar: PNG },
    });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.nickname).toBe('Ada_Lovelace');
    expect(b.firstName).toBe('Ada');
    expect(b.lastName).toBe('Lovelace');
    expect(b.avatar).toBe(PNG);

    const { body: me } = await request('/api/auth/me', {
      headers: authCookie(token),
    });
    expect((me as Record<string, unknown>).nickname).toBe('Ada_Lovelace');
  });

  it('clears a field when null is sent', async () => {
    const token = await registerUser('clear@example.com');
    await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(token),
      body: { firstName: 'Temp' },
    });
    const { body } = await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(token),
      body: { firstName: null },
    });
    expect((body as Record<string, unknown>).firstName).toBeNull();
  });

  it('returns 409 on a nickname taken by another user (case-insensitive)', async () => {
    const tokenA = await registerUser('nicka@example.com');
    const tokenB = await registerUser('nickb@example.com');
    await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(tokenA),
      body: { nickname: 'TakenName' },
    });
    const { status, body } = await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(tokenB),
      body: { nickname: 'takenname' },
    });
    expect(status).toBe(409);
    expect((body as Record<string, Record<string, string>>).error.code).toBe('CONFLICT');
  });

  it('allows keeping your own nickname (idempotent update)', async () => {
    const token = await registerUser('own@example.com');
    await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(token),
      body: { nickname: 'MyOwnNick' },
    });
    const { status } = await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(token),
      body: { nickname: 'MyOwnNick', firstName: 'X' },
    });
    expect(status).toBe(200);
  });

  it('returns 400 on an invalid avatar', async () => {
    const token = await registerUser('badavatar@example.com');
    const { status } = await request('/api/auth/me', {
      method: 'PATCH',
      headers: authCookie(token),
      body: { avatar: 'not-a-data-uri' },
    });
    expect(status).toBe(400);
  });
});

describe('POST /api/auth/change-password', () => {
  it('returns 401 without token', async () => {
    const { status } = await request('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: 'secret123', newPassword: 'newsecret123' },
    });
    expect(status).toBe(401);
  });

  it('returns 401 when the current password is wrong', async () => {
    const token = await registerUser('cpwrong@example.com');
    const { status } = await request('/api/auth/change-password', {
      method: 'POST',
      headers: authCookie(token),
      body: { currentPassword: 'wrongpassword', newPassword: 'newsecret123' },
    });
    expect(status).toBe(401);
  });

  it('changes the password: new one logs in, old one fails', async () => {
    const email = 'cpok@example.com';
    const token = await registerUser(email);
    const { status } = await request('/api/auth/change-password', {
      method: 'POST',
      headers: authCookie(token),
      body: { currentPassword: 'secret123', newPassword: 'newsecret123' },
    });
    expect(status).toBe(200);

    const ok = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password: 'newsecret123' },
    });
    expect(ok.status).toBe(200);

    const fail = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password: 'secret123' },
    });
    expect(fail.status).toBe(401);
  });

  it('returns 400 when the new password is too short', async () => {
    const token = await registerUser('cpshort@example.com');
    const { status } = await request('/api/auth/change-password', {
      method: 'POST',
      headers: authCookie(token),
      body: { currentPassword: 'secret123', newPassword: 'short' },
    });
    expect(status).toBe(400);
  });
});
