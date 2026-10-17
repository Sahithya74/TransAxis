import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { documentListQuerySchema, documentUploadSchema, idParamSchema } from '@transaxis/shared';
import { AppError } from '../../lib/errors.js';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { DocumentService } from './service.js';

export function documentRoutes(svc: DocumentService, maxDocumentMb: number): Router {
  const r = Router();
  const read = requirePermission('documents:read');
  const write = requirePermission('documents:write');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxDocumentMb * 1024 * 1024, files: 1, fields: 6 } });

  const single = (req: Request, res: Response, next: NextFunction) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'PAYLOAD_TOO_LARGE', `Documents can be at most ${maxDocumentMb} MB`));
        return next(AppError.validation(`Upload rejected: ${err.message}`));
      }
      next(err);
    });

  const fileFrom = (req: Request) => {
    if (!req.file) throw AppError.validation('Attach the document in the "file" field', [{ path: 'file', message: 'Choose a file' }]);
    return { buffer: req.file.buffer, originalName: req.file.originalname };
  };

  r.get('/', read, async (req, res) => {
    res.json(await svc.list(requireContext(req), documentListQuerySchema.parse(req.query)));
  });
  r.get('/summary', read, async (req, res) => {
    res.json(await svc.counts(requireContext(req)));
  });
  r.get('/:id', read, async (req, res) => {
    res.json(await svc.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.get('/:id/chunks', read, async (req, res) => {
    res.json({ data: await svc.chunks(requireContext(req), idParamSchema.parse(req.params).id) });
  });
  r.get('/:id/download', read, async (req, res) => {
    const { row, stream } = await svc.open(requireContext(req), idParamSchema.parse(req.params).id, req);
    res.setHeader('content-type', row.mime);
    res.setHeader('content-length', String(row.sizeBytes));
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName)}`);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    stream().on('error', () => res.destroy()).pipe(res);
  });
  r.post('/', write, single, async (req, res) => {
    const input = documentUploadSchema.parse(req.body ?? {});
    res.status(201).json(await svc.upload(requireContext(req), fileFrom(req), input, req));
  });
  r.post('/:id/versions', write, single, async (req, res) => {
    const input = documentUploadSchema.parse(req.body ?? {});
    res.status(201).json(await svc.upload(requireContext(req), fileFrom(req), input, req, idParamSchema.parse(req.params).id));
  });
  r.post('/:id/reprocess', write, async (req, res) => {
    res.json(await svc.reprocess(requireContext(req), idParamSchema.parse(req.params).id, req));
  });
  r.delete('/:id', write, async (req, res) => {
    await svc.remove(requireContext(req), idParamSchema.parse(req.params).id, req);
    res.status(204).end();
  });
  return r;
}
