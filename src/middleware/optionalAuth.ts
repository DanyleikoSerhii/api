import type { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/jwt.js';
import { getAuthToken } from '../lib/cookies.js';
import { env } from '../env.js';

type OptionalAuthVariables = {
  user: { sub: number; email: string } | null;
};

export const optionalAuth: MiddlewareHandler<{ Variables: OptionalAuthVariables }> = async (
  c,
  next,
) => {
  const token = getAuthToken(c);
  if (token) {
    try {
      const payload = await verifyToken(token, env.JWT_SECRET);
      c.set('user', { sub: payload.sub, email: payload.email });
    } catch {
      c.set('user', null);
    }
  } else {
    c.set('user', null);
  }
  await next();
};
