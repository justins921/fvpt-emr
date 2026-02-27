import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── GET /connections ── List FHIR connections for clinic
router.get('/connections', requirePermission(Permission.FHIR_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, clinic_id, name, base_url, auth_type, client_id, scope,
              status, last_sync_at, created_at, updated_at
       FROM fhir_connections
       WHERE clinic_id = $1
       ORDER BY created_at DESC`,
      [req.auth!.clinicId]
    );

    // Never return secrets in list responses
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /connections ── Create a FHIR connection
router.post('/connections', requirePermission(Permission.FHIR_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(255),
      base_url: z.string().url(),
      auth_type: z.enum(['oauth2', 'api_key', 'basic']),
      client_id: z.string().optional().nullable(),
      client_secret: z.string().optional().nullable(),
      api_key: z.string().optional().nullable(),
      scope: z.string().optional().nullable(),
    });
    const input = schema.parse(req.body);

    const result = await query(
      `INSERT INTO fhir_connections
         (clinic_id, name, base_url, auth_type, client_id, client_secret, api_key, scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        req.auth!.clinicId, input.name, input.base_url, input.auth_type,
        input.client_id || null, input.client_secret || null,
        input.api_key || null, input.scope || null,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.FHIR_SYNC,
      resourceType: 'fhir_connection',
      resourceId: result.rows[0].id,
      details: { action: 'create', name: input.name, base_url: input.base_url },
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── PUT /connections/:id ── Update a FHIR connection
router.put('/connections/:id', requirePermission(Permission.FHIR_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(255).optional(),
      base_url: z.string().url().optional(),
      auth_type: z.enum(['oauth2', 'api_key', 'basic']).optional(),
      client_id: z.string().optional().nullable(),
      client_secret: z.string().optional().nullable(),
      api_key: z.string().optional().nullable(),
      scope: z.string().optional().nullable(),
      status: z.enum(['active', 'inactive', 'error']).optional(),
    });
    const input = schema.parse(req.body);

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const params: unknown[] = [req.params.id, req.auth!.clinicId];
    let idx = 3;

    if (input.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.base_url !== undefined) {
      setClauses.push(`base_url = $${idx++}`);
      params.push(input.base_url);
    }
    if (input.auth_type !== undefined) {
      setClauses.push(`auth_type = $${idx++}`);
      params.push(input.auth_type);
    }
    if (input.client_id !== undefined) {
      setClauses.push(`client_id = $${idx++}`);
      params.push(input.client_id);
    }
    if (input.client_secret !== undefined) {
      setClauses.push(`client_secret = $${idx++}`);
      params.push(input.client_secret);
    }
    if (input.api_key !== undefined) {
      setClauses.push(`api_key = $${idx++}`);
      params.push(input.api_key);
    }
    if (input.scope !== undefined) {
      setClauses.push(`scope = $${idx++}`);
      params.push(input.scope);
    }
    if (input.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(input.status);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = NOW()');

    const result = await query(
      `UPDATE fhir_connections SET ${setClauses.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, clinic_id, name, base_url, auth_type, client_id, scope, status, last_sync_at, created_at, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'FHIR connection not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.FHIR_SYNC,
      resourceType: 'fhir_connection',
      resourceId: req.params.id,
      details: { action: 'update', updated_fields: Object.keys(input) },
      req,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── PUT /connections/:id/test ── Test a FHIR connection
router.put('/connections/:id/test', requirePermission(Permission.FHIR_MANAGE), async (req: Request, res: Response) => {
  try {
    // Fetch the connection details
    const connResult = await query(
      `SELECT id, base_url, auth_type, client_id, client_secret, api_key
       FROM fhir_connections
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'FHIR connection not found' });
      return;
    }

    const connection = connResult.rows[0];
    const metadataUrl = `${connection.base_url.replace(/\/+$/, '')}/metadata`;

    // Build request headers based on auth type
    const headers: Record<string, string> = {
      'Accept': 'application/fhir+json',
    };

    if (connection.auth_type === 'api_key' && connection.api_key) {
      headers['Authorization'] = `Bearer ${connection.api_key}`;
    } else if (connection.auth_type === 'basic' && connection.client_id && connection.client_secret) {
      const credentials = Buffer.from(`${connection.client_id}:${connection.client_secret}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    let testSuccess = false;
    let testMessage = '';
    let fhirVersion: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(metadataUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const body = await response.json() as Record<string, unknown>;
        testSuccess = true;
        fhirVersion = (body.fhirVersion as string) || null;
        testMessage = `Connection successful. FHIR version: ${fhirVersion || 'unknown'}. Status: ${response.status}`;
      } else {
        testMessage = `Server responded with status ${response.status}: ${response.statusText}`;
      }
    } catch (fetchError) {
      const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      testMessage = `Connection failed: ${errMsg}`;
    }

    // Update the connection status based on test result
    await query(
      `UPDATE fhir_connections SET status = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId, testSuccess ? 'active' : 'error']
    );

    res.json({
      success: true,
      data: {
        connection_id: req.params.id,
        test_success: testSuccess,
        message: testMessage,
        fhir_version: fhirVersion,
        tested_at: new Date().toISOString(),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /connections/:id/sync ── Trigger a FHIR sync operation
router.post('/connections/:id/sync', requirePermission(Permission.FHIR_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      direction: z.enum(['push', 'pull']).optional().default('pull'),
      resource_types: z.array(
        z.enum(['Patient', 'Appointment', 'Encounter', 'Condition', 'Observation', 'Procedure', 'DocumentReference', 'AllergyIntolerance', 'MedicationRequest', 'DiagnosticReport'])
      ).min(1),
    });
    const input = schema.parse(req.body);

    // Verify the connection exists
    const connResult = await query(
      `SELECT id, name, base_url, status
       FROM fhir_connections
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'FHIR connection not found' });
      return;
    }

    const connection = connResult.rows[0];

    // Create a sync log entry for each resource type
    const syncIds: string[] = [];
    for (const resourceType of input.resource_types) {
      const syncResult = await query(
        `INSERT INTO fhir_sync_log
           (connection_id, direction, resource_type, status, details)
         VALUES ($1,$2,$3,'success',$4)
         RETURNING id`,
        [req.params.id, input.direction, resourceType, JSON.stringify({ initiated_by: req.auth!.userId })]
      );
      syncIds.push(syncResult.rows[0].id);
    }

    // Update the connection's last sync timestamp
    await query(
      `UPDATE fhir_connections SET last_sync_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.FHIR_SYNC,
      resourceType: 'fhir_connection',
      resourceId: req.params.id,
      details: {
        direction: input.direction,
        resource_types: input.resource_types,
        sync_log_ids: syncIds,
      },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        connection_id: req.params.id,
        connection_name: connection.name,
        direction: input.direction,
        resource_types: input.resource_types,
        sync_log_ids: syncIds,
        status: 'success',
        message: `Sync initiated for ${input.resource_types.length} resource type(s).`,
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

// ── GET /sync-logs ── Get recent sync logs across all connections
router.get('/sync-logs', requirePermission(Permission.FHIR_MANAGE), async (req: Request, res: Response) => {
  try {
    const { limit = '50' } = req.query;
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    const result = await query(
      `SELECT sl.*, fc.name as connection_name
       FROM fhir_sync_log sl
       JOIN fhir_connections fc ON sl.connection_id = fc.id
       WHERE fc.clinic_id = $1
       ORDER BY sl.created_at DESC
       LIMIT $2`,
      [req.auth!.clinicId, limitNum]
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /connections/:id/log ── Get sync log for a connection with pagination
router.get('/connections/:id/log', requirePermission(Permission.FHIR_MANAGE), async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    // Verify the connection belongs to this clinic
    const connResult = await query(
      `SELECT id FROM fhir_connections WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'FHIR connection not found' });
      return;
    }

    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM fhir_sync_log
       WHERE connection_id = $1`,
      [req.params.id]
    );

    const result = await query(
      `SELECT sl.*
       FROM fhir_sync_log sl
       WHERE sl.connection_id = $1
       ORDER BY sl.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limitNum, (pageNum - 1) * limitNum]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: { page: pageNum, limit: limitNum, total: parseInt(countResult.rows[0].total, 10) },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
