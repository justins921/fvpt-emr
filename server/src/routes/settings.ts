import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission } from '../types';
import {
  getClinicAIStatus,
  setClinicAIConfig,
  clearClinicAIConfig,
  AIEncryptionUnavailableError,
} from '../services/aiConfig';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Per-clinic AI configuration (BYOK) ──

router.get('/ai', requirePermission(Permission.SETTINGS_MANAGE), async (req: Request, res: Response) => {
  try {
    const status = await getClinicAIStatus(req.auth!.clinicId);
    res.json({ success: true, data: status });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const putSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).optional(),
  apiKey: z.string().min(8).max(500).optional(),
  clearKey: z.boolean().optional(),
});

router.put('/ai', requirePermission(Permission.SETTINGS_MANAGE), async (req: Request, res: Response) => {
  try {
    const body = putSchema.parse(req.body);

    if (body.clearKey) {
      await clearClinicAIConfig(req.auth!.clinicId, req.auth!.userId);
      res.json({ success: true, data: { configured: false } });
      return;
    }

    if (!body.provider || !body.apiKey) {
      res.status(400).json({ success: false, error: 'Provider and API key are required.' });
      return;
    }

    await setClinicAIConfig(req.auth!.clinicId, { provider: body.provider, apiKey: body.apiKey }, req.auth!.userId);
    const status = await getClinicAIStatus(req.auth!.clinicId);
    res.json({ success: true, data: status });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input.' });
      return;
    }
    if (err instanceof AIEncryptionUnavailableError) {
      res.status(503).json({ success: false, error: err.message, encryptionUnavailable: true });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
