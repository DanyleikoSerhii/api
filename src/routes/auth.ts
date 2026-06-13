import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword, dummyVerifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { errorResponse, ErrorCode, defaultHook } from '../lib/errors.js';
import { env } from '../env.js';
import {
  Tags,
  credentialsSchema,
  authResponseSchema,
  profileSchema,
  updateProfileSchema,
  changePasswordSchema,
  errorResponseSchema,
} from '../openapi/schemas.js';

type AuthVariables = {
  user: { sub: number; email: string };
};

const jsonError = { content: { 'application/json': { schema: errorResponseSchema } } };

const messageSchema = z.object({ message: z.string().openapi({ example: 'Password updated' }) });

type UserRow = typeof users.$inferSelect;
function toProfile(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    firstName: u.firstName,
    lastName: u.lastName,
    avatar: u.avatar,
  };
}

const registerRoute = createRoute({
  operationId: 'register',
  method: 'post',
  path: '/api/auth/register',
  tags: [Tags.AUTH],
  summary: 'Register a new account',
  description:
    'Creates a user with a bcrypt-hashed password and returns a JWT access token (TTL 24h). Rate-limited (10 req/min per IP).',
  request: {
    body: { content: { 'application/json': { schema: credentialsSchema } }, required: true },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: authResponseSchema } },
      description: 'Account created',
    },
    400: { ...jsonError, description: 'Validation error' },
    409: { ...jsonError, description: 'Email already registered' },
    429: { ...jsonError, description: 'Too many requests' },
  },
});

const loginRoute = createRoute({
  operationId: 'login',
  method: 'post',
  path: '/api/auth/login',
  tags: [Tags.AUTH],
  summary: 'Log in with email and password',
  description: 'Returns a JWT access token (TTL 24h) on success. Rate-limited (10 req/min per IP).',
  request: {
    body: { content: { 'application/json': { schema: credentialsSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: authResponseSchema } },
      description: 'Logged in',
    },
    400: { ...jsonError, description: 'Validation error' },
    401: { ...jsonError, description: 'Invalid credentials' },
    429: { ...jsonError, description: 'Too many requests' },
  },
});

const meRoute = createRoute({
  operationId: 'getMe',
  method: 'get',
  path: '/api/auth/me',
  tags: [Tags.AUTH],
  summary: 'Get current user',
  description: "Returns the authenticated user's profile (id, email, nickname, names, avatar).",
  security: [{ BearerAuth: [] }],
  responses: {
    200: { content: { 'application/json': { schema: profileSchema } }, description: 'Current user' },
    401: { ...jsonError, description: 'Missing or invalid token' },
  },
});

const updateProfileRoute = createRoute({
  operationId: 'updateMe',
  method: 'patch',
  path: '/api/auth/me',
  tags: [Tags.AUTH],
  summary: 'Update the current profile',
  description:
    'Partial update of nickname, first/last name, and avatar. Omit a field to leave it unchanged; send null to clear it. Nickname is unique (case-insensitive).',
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: updateProfileSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: profileSchema } },
      description: 'Updated profile',
    },
    400: { ...jsonError, description: 'Validation error' },
    401: { ...jsonError, description: 'Missing or invalid token' },
    409: { ...jsonError, description: 'Nickname already taken' },
  },
});

const changePasswordRoute = createRoute({
  operationId: 'changePassword',
  method: 'post',
  path: '/api/auth/change-password',
  tags: [Tags.AUTH],
  summary: 'Change password',
  description:
    'Verifies the current password and sets a new one. Existing tokens remain valid (no revocation).',
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: changePasswordSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: messageSchema } },
      description: 'Password changed',
    },
    400: { ...jsonError, description: 'Validation error' },
    401: { ...jsonError, description: 'Missing token or wrong current password' },
  },
});

export const authRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook });

authRouter.use('/api/auth/register', rateLimit);
authRouter.use('/api/auth/login', rateLimit);

authRouter.openapi(registerRoute, async (c) => {
  const { email, password } = c.req.valid('json');

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return errorResponse(c, ErrorCode.CONFLICT, 'Email already registered') as never;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .returning({ id: users.id, email: users.email });

  if (!user) {
    return errorResponse(c, ErrorCode.INTERNAL_ERROR, 'Failed to create user') as never;
  }

  const token = await signToken(user.id, user.email, env.JWT_SECRET);
  return c.json({ token, user: { id: user.id, email: user.email } }, 201);
});

authRouter.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid('json');

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    // Run a dummy bcrypt compare to equalize response time vs the user-exists branch.
    await dummyVerifyPassword(password);
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'Invalid credentials') as never;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'Invalid credentials') as never;
  }

  const token = await signToken(user.id, user.email, env.JWT_SECRET);
  return c.json({ token, user: { id: user.id, email: user.email } }, 200);
});

authRouter.use('/api/auth/me', requireAuth);
authRouter.use('/api/auth/change-password', requireAuth);

authRouter.openapi(meRoute, async (c) => {
  const auth = c.get('user');
  const [u] = await db.select().from(users).where(eq(users.id, auth.sub)).limit(1);
  if (!u) {
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'User not found') as never;
  }
  return c.json(toProfile(u), 200);
});

authRouter.openapi(updateProfileRoute, async (c) => {
  const auth = c.get('user');
  const body = c.req.valid('json');

  const updates: Partial<Pick<UserRow, 'nickname' | 'firstName' | 'lastName' | 'avatar'>> = {};
  if (body.nickname !== undefined) updates.nickname = body.nickname;
  if (body.firstName !== undefined) updates.firstName = body.firstName;
  if (body.lastName !== undefined) updates.lastName = body.lastName;
  if (body.avatar !== undefined) updates.avatar = body.avatar;

  // Pre-check nickname uniqueness (case-insensitive), excluding the current user.
  if (updates.nickname != null) {
    const clash = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(sql`lower(${users.nickname}) = lower(${updates.nickname})`, ne(users.id, auth.sub)),
      )
      .limit(1);
    if (clash.length > 0) {
      return errorResponse(c, ErrorCode.CONFLICT, 'Nickname already taken') as never;
    }
  }

  if (Object.keys(updates).length === 0) {
    const [current] = await db.select().from(users).where(eq(users.id, auth.sub)).limit(1);
    if (!current) {
      return errorResponse(c, ErrorCode.UNAUTHORIZED, 'User not found') as never;
    }
    return c.json(toProfile(current), 200);
  }

  try {
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, auth.sub))
      .returning();
    if (!updated) {
      return errorResponse(c, ErrorCode.UNAUTHORIZED, 'User not found') as never;
    }
    return c.json(toProfile(updated), 200);
  } catch (err) {
    // Unique-violation race on the nickname index.
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return errorResponse(c, ErrorCode.CONFLICT, 'Nickname already taken') as never;
    }
    throw err;
  }
});

authRouter.openapi(changePasswordRoute, async (c) => {
  const auth = c.get('user');
  const { currentPassword, newPassword } = c.req.valid('json');

  const [u] = await db.select().from(users).where(eq(users.id, auth.sub)).limit(1);
  if (!u) {
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'User not found') as never;
  }
  const valid = await verifyPassword(currentPassword, u.passwordHash);
  if (!valid) {
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'Current password is incorrect') as never;
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, auth.sub));
  return c.json({ message: 'Password updated' }, 200);
});
