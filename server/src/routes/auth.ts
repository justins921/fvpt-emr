import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { login, refreshAccessToken, logout } from '../services/auth';
import { authenticate, validateSession } from '../middleware/auth';
import { loginLimiter } from '../middleware/security';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await login(email, password, req);
    if (!result) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }
    res.json({ success: true, data: result });
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
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, error: 'Refresh token required' });
      return;
    }
    const result = await refreshAccessToken(refreshToken, req);
    if (!result) {
      res.status(401).json({ success: false, error: 'Invalid refresh token' });
      return;
    }
    res.json({ success: true, data: result });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    if (req.auth) {
      await logout(req.auth.sessionId, req.auth.userId, req.auth.clinicId, req);
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/me', authenticate, validateSession, async (req: Request, res: Response) => {
  try {
    const { query: dbQuery } = await import('../db');
    const result = await dbQuery(
      `SELECT id, clinic_id, email, first_name, last_name, role, npi, license_number, is_active
       FROM users WHERE id = $1 AND clinic_id = $2`,
      [req.auth!.userId, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const user = result.rows[0];
    res.json({
      success: true,
      data: {
        id: user.id,
        clinicId: user.clinic_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        npi: user.npi,
        licenseNumber: user.license_number,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
