/**
 * Express error handling middleware
 */
import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  type?: string;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const errorType = err.type || 'server_error';

  console.error(`[Server Error] ${err.message}`);
  if (process.env.DEBUG === 'true') {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    error: {
      message: err.message,
      type: errorType
    }
  });
}
