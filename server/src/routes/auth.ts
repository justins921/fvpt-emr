import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { login, refreshAccessToken, logout, completeMfaLogin, switchClinicContext } from '../services/auth';
import { authenticate, validateSession, requireRole } from '../middleware/auth';
import { loginLimiter } from '../middleware/security';
import { generateMfaSetup, verifyAndEnableMfa, disableMfa } from '../services/mfa';
import { config } from '../config';
import { Role } from '../types';
import { query } from '../db';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
});

const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(1),
});

const mfaCodeSchema = z.object({
  code: z.string().min(1),
});

const mfaDisableSchema = z.object({
  userId: z.string().uuid(),
});

function setRefreshCookie(res: Response, token: string) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/auth',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const result = await login(username, password, req);
    if (!result) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }
    if (result.mfaRequired) {
      res.json({
        success: true,
        data: {
          mfaRequired: true,
          mfaToken: result.mfaToken,
          user: result.user,
        },
      });
      return;
    }
    setRefreshCookie(res, result.refreshToken);
    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    console.error('[LOGIN ERROR]', errMsg, errStack);
    res.status(500).json({ success: false, error: 'Internal server error', debug: errMsg });
  }
});

router.post('/mfa/verify-login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { mfaToken, code } = mfaVerifySchema.parse(req.body);
    const result = await completeMfaLogin(mfaToken, code, req);
    if (!result) {
      res.status(401).json({ success: false, error: 'Invalid MFA code or token' });
      return;
    }
    setRefreshCookie(res, result.refreshToken);
    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/mfa/setup', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await generateMfaSetup(req.auth!.userId, req.auth!.clinicId);
    res.json({
      success: true,
      data: {
        qrCodeDataUrl: result.qrCodeDataUrl,
        secret: result.secret,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/mfa/enable', authenticate, async (req: Request, res: Response) => {
  try {
    const { code } = mfaCodeSchema.parse(req.body);
    const success = await verifyAndEnableMfa(req.auth!.userId, req.auth!.clinicId, code);
    if (!success) {
      res.status(400).json({ success: false, error: 'Invalid MFA code' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/mfa/disable', authenticate, requireRole(Role.ADMIN), async (req: Request, res: Response) => {
  try {
    const { userId } = mfaDisableSchema.parse(req.body);
    await disableMfa(userId, req.auth!.clinicId);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(400).json({ success: false, error: 'Refresh token required' });
      return;
    }
    const result = await refreshAccessToken(refreshToken, req);
    if (!result) {
      res.status(401).json({ success: false, error: 'Invalid refresh token' });
      return;
    }
    setRefreshCookie(res, result.refreshToken);
    res.json({ success: true, data: { accessToken: result.accessToken } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    if (req.auth) {
      await logout(req.auth.sessionId, req.auth.userId, req.auth.clinicId, req);
    }
    clearRefreshCookie(res);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/me', authenticate, validateSession, async (req: Request, res: Response) => {
  try {
    // For dev users, look up user by ID only (they may be operating in a different clinic)
    const isDev = req.auth!.role === Role.DEV;
    const userQuery = isDev
      ? `SELECT id, clinic_id, username, first_name, last_name, role, npi, license_number, is_active, mfa_enabled
         FROM users WHERE id = $1`
      : `SELECT id, clinic_id, username, first_name, last_name, role, npi, license_number, is_active, mfa_enabled
         FROM users WHERE id = $1 AND clinic_id = $2`;
    const userParams = isDev ? [req.auth!.userId] : [req.auth!.userId, req.auth!.clinicId];
    const result = await query(userQuery, userParams);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const user = result.rows[0];

    // For dev users, include the active clinic info and clinic list
    const responseData: Record<string, unknown> = {
      id: user.id,
      clinicId: req.auth!.clinicId, // The active clinic context from JWT
      homeClinicId: user.clinic_id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      npi: user.npi,
      licenseNumber: user.license_number,
      mfaEnabled: user.mfa_enabled,
    };

    if (isDev) {
      // Fetch all clinics for the clinic switcher
      const clinicsResult = await query(
        `SELECT id, name, npi, city, state FROM clinics ORDER BY name`
      );
      responseData.clinics = clinicsResult.rows;

      // Fetch active clinic name
      const activeClinic = clinicsResult.rows.find((c: any) => c.id === req.auth!.clinicId);
      responseData.clinicName = activeClinic?.name || 'Unknown';
    }

    res.json({ success: true, data: responseData });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Dev-only: Switch clinic context ──
router.post('/switch-clinic', authenticate, validateSession, async (req: Request, res: Response) => {
  try {
    const schema = z.object({ clinicId: z.string().uuid() });
    const { clinicId: targetClinicId } = schema.parse(req.body);

    const result = await switchClinicContext(
      req.auth!.userId,
      targetClinicId,
      req.auth!.role as Role,
      req
    );

    if (!result) {
      res.status(403).json({ success: false, error: 'Clinic switch not allowed' });
      return;
    }

    setRefreshCookie(res, result.refreshToken);
    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
