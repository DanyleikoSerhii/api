import type { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/jwt.js';
import { errorResponse, ErrorCode } from '../lib/errors.js';
import { env } from '../env.js';

type AuthVariables = {
  user: { sub: number; email: string };
};

export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'Missing or invalid Authorization header');
  }
  try {
    const payload = await verifyToken(token, env.JWT_SECRET);
    c.set('user', { sub: payload.sub, email: payload.email });
  } catch {
    return errorResponse(c, ErrorCode.UNAUTHORIZED, 'Invalid or expired token');
  }
  await next();
  return undefined;
};
