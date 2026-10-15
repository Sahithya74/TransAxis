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
