import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

/**
 * Global rate limiter: limits requests per IP per minute
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimit.globalMaxPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Auth rate limiter: stricter limit for authentication endpoints
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimit.authMaxPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

/**
 * Correlation ID middleware: assigns or propagates X-Request-Id header
 */
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
