import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'BUSINESS_RULE'
  | 'ASSIGNMENT_BLOCKED'
  | 'OVERRIDE_REQUIRED'
  | 'OTP_INVALID'
  | 'OTP_LOCKED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR';

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(message: string, details?: unknown) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  /** Also used for rows that exist in another organisation, so IDs cannot be probed. */
  static notFound(what = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${what} not found`);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  static businessRule(message: string, details?: unknown) {
    return new AppError(422, 'BUSINESS_RULE', message, details);
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; requestId?: string };
}

/** MySQL deadlock (1213) or lock-wait timeout (1205), possibly wrapped by the ORM. */
function isLockContention(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: string }).code;
    if (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path}`));
};

type Logger = { error: (obj: unknown, msg?: string) => void };

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error middleware by arity, so all four parameters are required.
  return (err, req, res, _next) => {
    const requestId = (req as { id?: unknown }).id as string | undefined;
    let status = 500;
    let body: ErrorBody['error'] = {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (isLockContention(err)) {
      // Concurrent writers collided; nothing was committed and the client can simply retry.
      status = 409;
      body = { code: 'CONFLICT', message: 'Another change was being saved at the same time. Please retry.' };
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' };
    } else if ((err as { type?: string }).type === 'entity.too.large') {
      status = 413;
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    }

    if (status >= 500) {
      // Full detail goes to the server log only; the client sees the generic message.
      logger.error({ err, requestId, path: req.path }, 'unhandled error');
    }
    res.status(status).json({ error: { ...body, requestId } } satisfies ErrorBody);
  };
}
