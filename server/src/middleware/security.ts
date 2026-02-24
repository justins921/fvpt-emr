import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }, // 2 years, preload-ready
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

/** Additional Permissions-Policy header for hardened browser security. */
export function permissionsPolicy(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );
  next();
}

const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map(s => s.trim());

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin) return callback(null, true);
    // Allow configured origins
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // On Vercel, allow any *.vercel.app preview deployments
    if (process.env.VERCEL === '1' && origin.endsWith('.vercel.app')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
  keyGenerator: (req) => req.ip || 'unknown',
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit exceeded' },
});

export function ipAllowlist(req: Request, res: Response, next: NextFunction): void {
  if (!config.IP_ALLOWLIST) {
    next();
    return;
  }

  const allowed = config.IP_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    next();
    return;
  }

  const clientIp = req.ip || req.socket.remoteAddress || '';
  const isAllowed = allowed.some(ip => {
    if (ip.includes('/')) {
      // Basic CIDR support for common cases
      return clientIp.startsWith(ip.split('/')[0].split('.').slice(0, 3).join('.'));
    }
    return clientIp === ip || clientIp === `::ffff:${ip}`;
  });

  if (!isAllowed) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return;
  }

  next();
}

// Sanitize error responses to prevent PHI leakage
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // NEVER log PHI - only log error type and message
  console.error('Unhandled error:', {
    type: err.constructor.name,
    message: err.message,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: config.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
}
