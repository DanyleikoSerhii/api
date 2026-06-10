import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
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
  userSchema,
  errorResponseSchema,
} from '../openapi/schemas.js';

type AuthVariables = {
  user: { sub: number; email: string };
};

const jsonError = { content: { 'application/json': { schema: errorResponseSchema } } };

const registerRoute = createRoute({
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
  method: 'get',
  path: '/api/auth/me',
  tags: [Tags.AUTH],
  summary: 'Get current user',
  description: "Returns the authenticated user's id and email.",
  security: [{ BearerAuth: [] }],
  responses: {
    200: { content: { 'application/json': { schema: userSchema } }, description: 'Current user' },
    401: { ...jsonError, description: 'Missing or invalid token' },
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
authRouter.openapi(meRoute, (c) => {
  const user = c.get('user');
  return c.json({ id: user.sub, email: user.email }, 200);
});
