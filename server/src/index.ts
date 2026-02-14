import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { securityHeaders, corsMiddleware, apiLimiter, ipAllowlist, errorHandler } from './middleware/security';

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import patientRoutes from './routes/patients';
import schedulingRoutes from './routes/scheduling';
import noteRoutes from './routes/notes';
import attachmentRoutes from './routes/attachments';
import billingRoutes from './routes/billing';
import auditRoutes from './routes/audit';
import dictationRoutes from './routes/dictation';
import exportRoutes from './routes/exports';

const app = express();

// Trust proxy if behind reverse proxy
if (config.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Global middleware
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(ipAllowlist);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/api', apiLimiter);

// Health check (no auth required, no PHI)
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      version: process.env.npm_package_version || '0.1.0',
      timestamp: new Date().toISOString(),
    },
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/dictation', dictationRoutes);
app.use('/api/export', exportRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Global error handler
app.use(errorHandler);

// Start server
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`FVPT-EMR server running on ${config.HOST}:${config.PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`CORS origins: ${config.ALLOWED_ORIGINS}`);
});

// Graceful shutdown
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

export default app;
