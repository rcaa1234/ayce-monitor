import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import { UserModel } from '../models/user.model';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    roles: string[];
  };
}

/**
 * Verify JWT token
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);

    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
    };

    // Get user and roles
    const user = await UserModel.findById(decoded.userId);

    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    const roles = await UserModel.getRoles(user.id);

    req.user = {
      id: user.id,
      email: user.email,
      roles,
    };

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Check if user has required role
 */
export function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!req.user.roles.includes(role) && !req.user.roles.includes('admin')) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Optional authentication - doesn't fail if no token
 */
export async function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, config.jwt.secret) as {
        userId: string;
        email: string;
      };

      const user = await UserModel.findById(decoded.userId);

      if (user && user.status === 'ACTIVE') {
        const roles = await UserModel.getRoles(user.id);

        req.user = {
          id: user.id,
          email: user.email,
          roles,
        };
      }
    }
  } catch (error) {
    // Ignore errors for optional auth
  }

  next();
}
