import type { MiddlewareHandler } from 'hono';
import type { IncomingMessage } from 'node:http';
import { ErrorCode, errorResponse } from '../lib/errors.js';

type WindowEntry = { count: number; windowStart: number };

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
const MAX_ENTRIES = 10_000;

const store = new Map<string, WindowEntry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of store) {
    if (now - entry.windowStart >= WINDOW_MS) store.delete(key);
  }
}

function getClientIp(c: Parameters<MiddlewareHandler>[0]): string {
  // Use the raw socket address — header-based IPs (x-forwarded-for) can be
  // spoofed unless we trust an upstream proxy, and we don't have a trusted-
  // proxy list configured here.
  const env = c.env as { incoming?: IncomingMessage } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export function resetRateLimitStore(): void {
  store.clear();
}

export const rateLimit: MiddlewareHandler = async (c, next) => {
  const ip = getClientIp(c);
  const now = Date.now();

  if (store.size >= MAX_ENTRIES) pruneExpired(now);

  const entry = store.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    return next();
  }

  entry.count++;
  if (entry.count > MAX_REQUESTS) {
    return errorResponse(c, ErrorCode.RATE_LIMITED, 'Too many requests, please try again later.');
  }

  return next();
};
