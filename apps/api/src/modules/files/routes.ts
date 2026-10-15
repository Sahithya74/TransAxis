import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { FILE_CATEGORIES, idParamSchema, idSchema } from '@transaxis/shared';
import { AppError } from '../../lib/errors.js';
import { requireContext } from '../../middleware/auth.js';
import type { FileService } from './service.js';

const uploadBody = z.object({ category: z.enum(FILE_CATEGORIES), tripId: idSchema.optional() });

export function fileRoutes(svc: FileService, maxUploadMb: number): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1, fields: 5 },
  });

  // Translate multer's errors into the standard error envelope.
  const single = (req: Request, res: Response, next: NextFunction) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError(413, 'PAYLOAD_TOO_LARGE', `File is larger than ${maxUploadMb} MB`));
        }
        return next(AppError.validation(`Upload rejected: ${err.message}`));
      }
      next(err);
    });

  r.post('/', single, async (req, res) => {
    const ctx = requireContext(req);
    const { category, tripId } = uploadBody.parse(req.body ?? {});
    if (!req.file) throw AppError.validation('Attach a file in the "file" field', [{ path: 'file', message: 'Required' }]);
    const dto = await svc.upload(ctx, { buffer: req.file.buffer, originalName: req.file.originalname, category, tripId }, req);
    res.status(201).json(dto);
  });

  r.get('/:id/download', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { row, stream } = await svc.open(requireContext(req), id, req);
    res.setHeader('content-type', row.mime);
    res.setHeader('content-length', String(row.sizeBytes));
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName)}`);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    stream().on('error', () => res.destroy()).pipe(res);
  });

  return r;
}
