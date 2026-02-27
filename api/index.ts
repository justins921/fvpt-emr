// Vercel serverless function entry point
// Wraps the Express app for Vercel's Node.js runtime
// Uses dynamic import so we can catch and report startup errors
import type { Request, Response } from 'express';

let appPromise: Promise<{ default: any }> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = import('../server/src/app');
  }
  return appPromise;
}

export default async function handler(req: Request, res: Response) {
  try {
    const mod = await getApp();
    const app = mod.default;
    return app(req, res);
  } catch (err: any) {
    // If the app fails to load, return the actual error so we can diagnose
    console.error('Serverless function failed to load app:', err);
    res.status(500).json({
      success: false,
      error: 'App failed to start',
      message: err?.message || String(err),
      stack: err?.stack?.split('\n').slice(0, 10),
    });
  }
}
