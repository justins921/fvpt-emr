// Vercel serverless function entry point
// Uses dynamic import with error catching so startup crashes return useful JSON
import type { IncomingMessage, ServerResponse } from 'http';

let appHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let startupError: string | null = null;

const appReady = import('../server/src/app')
  .then((mod) => {
    appHandler = mod.default;
  })
  .catch((err) => {
    startupError = err instanceof Error
      ? `${err.message}\n${err.stack}`
      : String(err);
    console.error('[STARTUP CRASH]', startupError);
  });

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await appReady;

  if (startupError || !appHandler) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: startupError || 'App handler not loaded',
    }));
    return;
  }

  return appHandler(req, res);
}
