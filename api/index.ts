// Vercel serverless function entry point
// Wraps the Express app for Vercel's Node.js runtime
import type { Request, Response } from 'express';

let app: unknown;
let startupError: Error | null = null;

try {
  app = require('../server/src/app').default;
} catch (e) {
  startupError = e instanceof Error ? e : new Error(String(e));
  console.error('[STARTUP CRASH]', startupError.message, startupError.stack);
}

export default function handler(req: Request, res: Response) {
  if (startupError) {
    res.status(500).json({
      success: false,
      error: 'App failed to start',
      debug: startupError.message,
      stack: startupError.stack,
    });
    return;
  }
  return (app as (req: Request, res: Response) => void)(req, res);
}
