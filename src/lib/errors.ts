import type { Context } from 'hono';
import type { Hook } from '@hono/zod-openapi';

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const statusMap: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  get status(): number {
    return statusMap[this.code];
  }
}

export function errorResponse(c: Context, code: ErrorCode, message: string, details?: unknown) {
  return c.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    statusMap[code] as 400 | 401 | 404 | 409 | 500,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const defaultHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    return errorResponse(c, ErrorCode.VALIDATION_ERROR, 'Validation error', result.error.issues);
  }
  return undefined;
};
