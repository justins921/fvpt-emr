import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';
import { config } from '../config';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = config.UPLOAD_DIR;
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// Upload attachment
router.post('/', requirePermission(Permission.ATTACHMENT_UPLOAD), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const { patientId, noteId, claimId } = req.body;

    const result = await query(
      `INSERT INTO attachments (clinic_id, patient_id, note_id, claim_id, filename, original_filename, mime_type, size_bytes, storage_path, uploaded_by, scan_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING id`,
      [
        req.auth!.clinicId,
        patientId || null,
        noteId || null,
        claimId || null,
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.path,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.ATTACHMENT_UPLOAD,
      resourceType: 'attachment',
      resourceId: result.rows[0].id,
      details: { mimeType: req.file.mimetype, sizeBytes: req.file.size },
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// List attachments for patient
router.get('/patient/:patientId', requirePermission(Permission.ATTACHMENT_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT a.id, a.original_filename, a.mime_type, a.size_bytes, a.scan_status, a.created_at,
              u.first_name as uploader_first_name, u.last_name as uploader_last_name
       FROM attachments a
       JOIN users u ON a.uploaded_by = u.id
       WHERE a.clinic_id = $1 AND a.patient_id = $2
       ORDER BY a.created_at DESC`,
      [req.auth!.clinicId, req.params.patientId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Download attachment (token-based access)
router.get('/:id/download', requirePermission(Permission.ATTACHMENT_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM attachments WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Attachment not found' });
      return;
    }

    const attachment = result.rows[0];

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.ATTACHMENT_VIEW,
      resourceType: 'attachment',
      resourceId: req.params.id,
      req,
    });

    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.original_filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const fileBuffer = await fs.readFile(attachment.storage_path);
    res.send(fileBuffer);
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Delete attachment
router.delete('/:id', requirePermission(Permission.ATTACHMENT_DELETE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT storage_path FROM attachments WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Attachment not found' });
      return;
    }

    // Delete file from disk
    try {
      await fs.unlink(result.rows[0].storage_path);
    } catch {
      // File may already be deleted
    }

    await query('DELETE FROM attachments WHERE id = $1', [req.params.id]);

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.ATTACHMENT_DELETE,
      resourceType: 'attachment',
      resourceId: req.params.id,
      req,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
