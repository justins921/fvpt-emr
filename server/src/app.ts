import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { securityHeaders, corsMiddleware, apiLimiter, ipAllowlist, errorHandler, permissionsPolicy } from './middleware/security';
import { checkHealth } from './db';

// Existing Routes
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
import importRoutes from './routes/import';
import supportRoutes from './routes/support';
import messagingRoutes from './routes/messaging';

// New Feature Routes
import hepRoutes from './routes/hep';
import pocRoutes from './routes/plans-of-care';
import outcomeRoutes from './routes/outcome-measures';
import intakeRoutes from './routes/intake-forms';
import eligibilityRoutes from './routes/eligibility';
import faxRoutes from './routes/fax';
import telehealthRoutes from './routes/telehealth';
import waitlistRoutes from './routes/waitlist';
import taskRoutes from './routes/tasks';
import recallRoutes from './routes/recall';
import textExpanderRoutes from './routes/text-expanders';
import reportingRoutes from './routes/reporting';
import portalRoutes from './routes/portal';
import workersCompRoutes from './routes/workers-comp';
import mipsRoutes from './routes/mips';
import fhirRoutes from './routes/fhir';
import locationRoutes from './routes/locations';
import statementRoutes from './routes/statements';
import paymentRoutes from './routes/payments';
import authorizationRoutes from './routes/authorizations';
import noteUtilRoutes from './routes/note-utils';
import referringProviderRoutes from './routes/referring-providers';

const app = express();

// Trust proxy (Vercel, Caddy, etc.)
if (config.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Global middleware
app.use(securityHeaders);
app.use(permissionsPolicy);
app.use(corsMiddleware);
app.use(ipAllowlist);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/api', apiLimiter);

// Health check (no auth required, no PHI)
app.get('/api/health', async (_req, res) => {
  const db = await checkHealth();
  const status = db.ok ? 'healthy' : 'degraded';
  const httpCode = db.ok ? 200 : 503;
  res.status(httpCode).json({
    success: db.ok,
    data: {
      status,
      version: process.env.npm_package_version || '0.1.0',
      timestamp: new Date().toISOString(),
      database: { connected: db.ok, latencyMs: db.latencyMs },
      uptime: Math.floor(process.uptime()),
    },
  });
});

// Temporary diagnostic endpoint — remove after debugging login
app.get('/api/debug/login-check', async (_req, res) => {
  const { query: dbQuery } = await import('./db');
  const diagnostics: Record<string, unknown> = {
    env: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      hasDbUrl: !!process.env.DATABASE_URL,
      hasPostgresUrl: !!process.env.POSTGRES_URL,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasPhiKey: !!process.env.PHI_ENCRYPTION_KEY,
    },
  };
  try {
    const dbCheck = await dbQuery('SELECT 1 AS ok');
    diagnostics.dbConnected = dbCheck.rows.length > 0;
  } catch (e) {
    diagnostics.dbConnected = false;
    diagnostics.dbError = e instanceof Error ? e.message : String(e);
  }
  try {
    const cols = await dbQuery(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position`
    );
    diagnostics.userColumns = cols.rows.map((r: Record<string, unknown>) => r.column_name);
  } catch (e) {
    diagnostics.userColumnsError = e instanceof Error ? e.message : String(e);
  }
  try {
    const userCount = await dbQuery('SELECT COUNT(*) AS cnt FROM users');
    diagnostics.userCount = userCount.rows[0].cnt;
  } catch (e) {
    diagnostics.userCountError = e instanceof Error ? e.message : String(e);
  }
  try {
    // Check if admin user exists (no PHI — just username and role)
    const admin = await dbQuery(
      `SELECT username, role, is_active, clinic_id FROM users WHERE username = 'admin' LIMIT 1`
    );
    diagnostics.adminUser = admin.rows.length > 0 ? admin.rows[0] : 'NOT FOUND';
  } catch (e) {
    diagnostics.adminUserError = e instanceof Error ? e.message : String(e);
  }
  res.json({ success: true, diagnostics });
});

// ── Existing API routes ──
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
app.use('/api/import', importRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/messaging', messagingRoutes);

// ── New Feature API routes ──
app.use('/api/exercises', hepRoutes);
app.use('/api/plans-of-care', pocRoutes);
app.use('/api/outcome-measures', outcomeRoutes);
app.use('/api/intake-forms', intakeRoutes);
app.use('/api/eligibility', eligibilityRoutes);
app.use('/api/fax', faxRoutes);
app.use('/api/telehealth', telehealthRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/recall', recallRoutes);
app.use('/api/text-expanders', textExpanderRoutes);
app.use('/api/reporting', reportingRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/workers-comp', workersCompRoutes);
app.use('/api/mips', mipsRoutes);
app.use('/api/fhir', fhirRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/statements', statementRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/authorizations', authorizationRoutes);
app.use('/api/note-utils', noteUtilRoutes);
app.use('/api/referring-providers', referringProviderRoutes);

// 404 handler for API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Global error handler
app.use(errorHandler);

export default app;
