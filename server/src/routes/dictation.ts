import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { Permission } from '../types';
import { LocalStubTranscriptionProvider } from '../adapters/transcription';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const transcriptionProvider = new LocalStubTranscriptionProvider();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for audio
});

// Check transcription availability
router.get('/status', requirePermission(Permission.NOTE_CREATE), async (_req: Request, res: Response) => {
  const available = await transcriptionProvider.isAvailable();
  res.json({ success: true, data: { available, provider: 'local-stub' } });
});

// Transcribe audio
router.post('/transcribe', requirePermission(Permission.NOTE_CREATE), upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No audio file provided' });
      return;
    }

    const result = await transcriptionProvider.transcribe(req.file.buffer, req.file.mimetype);

    res.json({
      success: true,
      data: {
        text: result.text,
        confidence: result.confidence,
        provider: 'local-stub',
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Transcription failed' });
  }
});

export default router;
