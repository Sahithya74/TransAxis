import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { files, type Db } from '@transaxis/database';
import { FILE_CATEGORY_RULES, type FileCategory, type FileDto } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { assertTripAccess } from '../../lib/trip-access.js';

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  category: FileCategory;
  /** Required for trip documents: the trip the photo/document belongs to. */
  tripId?: number;
}

const anyOf = (ctx: RequestContext, perms: readonly string[]) => perms.some((p) => ctx.permissions.has(p as never));

export class FileService {
  constructor(
    private readonly db: Db,
    private readonly uploadDir: string,
  ) {}

  async upload(ctx: RequestContext, input: UploadInput, req: Request): Promise<FileDto> {
    const rules = FILE_CATEGORY_RULES[input.category];
    if (!anyOf(ctx, rules.upload)) throw AppError.forbidden();
    if (input.category === 'trip_document') {
      if (!input.tripId) throw AppError.validation('tripId is required for trip documents', [{ path: 'tripId', message: 'Required' }]);
      await assertTripAccess(this.db, ctx, input.tripId);
    }
    if (input.buffer.length === 0) throw AppError.validation('The file is empty');

    // Trust the bytes, not the filename or the browser-supplied Content-Type.
    const detected = await fileTypeFromBuffer(input.buffer);
    if (!detected || !(rules.mimes as string[]).includes(detected.mime)) {
      throw new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported file type. Allowed: ${rules.mimes.map((m) => EXT[m]!.toUpperCase()).join(', ')}`,
      );
    }

    const now = new Date();
    // Server-generated key: never derived from user input, so no path traversal or overwrite.
    const storageKey = `${ctx.orgId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXT[detected.mime]}`;
    const fullPath = this.pathFor(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.buffer, { flag: 'wx' });

    const [created] = await this.db
      .insert(files)
      .values({
        orgId: ctx.orgId,
        storageKey,
        originalName: sanitiseName(input.originalName, EXT[detected.mime]!),
        mime: detected.mime,
        sizeBytes: input.buffer.length,
        sha256: createHash('sha256').update(input.buffer).digest('hex'),
        category: input.category,
        entityType: input.tripId ? 'trip' : null,
        entityId: input.tripId ?? null,
        uploadedBy: ctx.userId,
      })
      .$returningId();
    const [row] = await this.db.select().from(files).where(eq(files.id, created!.id));
    await audit(this.db, req, {
      action: 'file.uploaded',
      entityType: 'file',
      entityId: row!.id,
      summary: `${row!.originalName} (${detected.mime}, ${row!.sizeBytes} bytes)`,
    });
    return toDto(row!);
  }

  /** Resolves a file for download after org scoping and the category's read permission. */
  async open(ctx: RequestContext, id: number, req: Request) {
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.orgId, ctx.orgId)))
      .limit(1);
    if (!row) throw AppError.notFound('File');
    const rules = FILE_CATEGORY_RULES[row.category as FileCategory];
    if (!rules || !anyOf(ctx, rules.download)) throw AppError.notFound('File');
    // Drivers may only fetch documents attached to their own trips.
    if (row.category === 'trip_document' && !ctx.permissions.has('trips:read')) {
      if (row.entityType !== 'trip' || !row.entityId) throw AppError.notFound('File');
      await assertTripAccess(this.db, ctx, row.entityId).catch(() => {
        throw AppError.notFound('File');
      });
    }

    const fullPath = this.pathFor(row.storageKey);
    try {
      await stat(fullPath);
    } catch {
      throw AppError.notFound('File content');
    }
    await audit(this.db, req, { action: 'file.downloaded', entityType: 'file', entityId: row.id, summary: row.originalName });
    return { row, stream: () => createReadStream(fullPath) };
  }

  /** Validates that file ids belong to the org (and, for trip documents, to the given trip). */
  async assertOwned(ctx: RequestContext, ids: number[], tripId?: number): Promise<void> {
    for (const id of ids) {
      const [f] = await this.db
        .select({ id: files.id, entityType: files.entityType, entityId: files.entityId })
        .from(files)
        .where(and(eq(files.id, id), eq(files.orgId, ctx.orgId)))
        .limit(1);
      if (!f || (tripId && (f.entityType !== 'trip' || f.entityId !== tripId))) {
        throw AppError.validation('Unknown file', [{ path: 'fileId', message: `File ${id} not found for this record` }]);
      }
    }
  }

  private pathFor(storageKey: string): string {
    const root = resolve(this.uploadDir);
    const full = resolve(join(root, storageKey));
    if (!full.startsWith(root + sep)) throw AppError.notFound('File');
    return full;
  }
}

/** Keeps a readable display name: strips paths and control characters and forces the real extension. */
export function sanitiseName(name: string, ext: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // Control characters are matched on purpose: they must never reach a Content-Disposition header.
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f"<>|:*?]/g, '').trim().slice(0, 200) || 'file';
  const stem = extname(cleaned) ? cleaned.slice(0, -extname(cleaned).length) : cleaned;
  return `${stem || 'file'}.${ext}`;
}

function toDto(row: typeof files.$inferSelect): FileDto {
  return {
    id: row.id,
    originalName: row.originalName,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
  };
}
