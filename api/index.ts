// Vercel serverless function entry point
// Uses dynamic import to catch and report any startup errors
import type { IncomingMessage, ServerResponse } from 'http';

let handler: any = null;
let loadError: any = null;

// Try to load at module level using require (works with compiled CJS)
try {
  handler = require('../server/dist/app').default;
} catch (err) {
  loadError = err;
  console.error('Failed to load app:', err);
}

export default function (req: IncomingMessage, res: ServerResponse) {
  if (loadError || !handler) {
    const err = loadError;
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'App failed to start',
      message: err?.message || 'handler is null',
      stack: err?.stack?.split('\n').slice(0, 15),
    }));
    return;
  }
  return handler(req, res);
}
