import app from './app';
import { config } from './config';

// When running as standalone server (local dev, Docker), listen on port.
// When imported by Vercel serverless, this file is NOT the entry point —
// api/index.ts imports app.ts directly.
const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`EMR OS server running on ${config.HOST}:${config.PORT}`);
    console.log(`Environment: ${config.NODE_ENV}`);
    console.log(`CORS origins: ${config.ALLOWED_ORIGINS}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down...');
    server.close(() => {
      process.exit(0);
    });
  });
}

export default app;
