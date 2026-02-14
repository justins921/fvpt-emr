import { Router, Request, Response } from 'express';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { Permission } from '../types';
import { getAuditLog } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

router.get('/', requirePermission(Permission.AUDIT_VIEW), async (req: Request, res: Response) => {
  try {
    const { userId, action, resourceType, resourceId, fromDate, toDate, page, limit } = req.query;
    const result = await getAuditLog(req.auth!.clinicId, {
      userId: userId as string,
      action: action as string,
      resourceType: resourceType as string,
      resourceId: resourceId as string,
      fromDate: fromDate as string,
      toDate: toDate as string,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json({
      success: true,
      data: result.events,
      meta: { total: result.total },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
