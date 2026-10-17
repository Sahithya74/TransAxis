import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import type { Request } from 'express';
import { and, asc, count, desc, eq, inArray, like, lt, ne, or, type SQL } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import type { Logger } from 'pino';
import { documentChunks, documents, organizations, users, type Db } from '@transaxis/database';
import {
  CLASSIFICATION_LABELS,
  DOCUMENT_EXTENSIONS,
  readableClassifications,
  type DocumentChunkDto,
  type DocumentClassification,
  type DocumentDto,
  type DocumentStatus,
  type DocumentUploadInput,
  type Paginated,
} from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { getOrgInfo } from '../../lib/org.js';
import { paginated, parseSort } from '../../lib/http.js';
import { systemIdentity, type RagClient } from '../../lib/rag.js';
import { sanitiseName } from '../files/service.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_MIME: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv' };

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
}

type Row = typeof documents.$inferSelect;

/** Text files have no magic bytes, so check that the content really is text: UTF-8 and no binary noise. */
function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return false;
  }
  const sample = buf.subarray(0, 8192);
  let control = 0;
  for (const b of sample) if (b < 9 || (b > 13 && b < 32)) control++;
  return control / Math.max(1, sample.length) < 0.01;
}

/**
 * The document library. Each document has a classification; people see only the classifications their
 * permissions allow (the same rule the assistant's retrieval applies). Files are parsed and indexed by
 * the RAG service; if it is down, uploads wait in the queue and a background job retries them.
 */
export class DocumentService {
  constructor(
    private readonly db: Db,
    private readonly uploadDir: string,
    private readonly rag: RagClient,
    private readonly log: Logger,
  ) {}

  private readable(ctx: RequestContext): DocumentClassification[] {
    const cls = readableClassifications((p) => ctx.permissions.has(p));
    if (!cls.length) throw AppError.forbidden();
    return cls;
  }

  private pathFor(storageKey: string): string {
    const root = resolve(this.uploadDir);
    const full = resolve(join(root, storageKey));
    if (!full.startsWith(root + sep)) throw AppError.notFound('Document');
    return full;
  }

  private select() {
    return this.db.select({ d: documents, uploader: users.fullName }).from(documents).leftJoin(users, eq(users.id, documents.uploadedBy));
  }

  /** A document the caller may see, or 404 (also for other organisations and hidden classifications). */
  private async visible(ctx: RequestContext, id: number): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.orgId, ctx.orgId), inArray(documents.classification, this.readable(ctx))));
    if (!row) throw AppError.notFound('Document');
    return row;
  }

  async list(ctx: RequestContext, q: { page: number; pageSize: number; sort?: string; q?: string; classification?: DocumentClassification; status?: DocumentStatus; docType?: string; includeSuperseded?: string }) {
    const conds: SQL[] = [eq(documents.orgId, ctx.orgId), inArray(documents.classification, this.readable(ctx))];
    if (q.classification) conds.push(eq(documents.classification, q.classification));
    if (q.status) conds.push(eq(documents.status, q.status));
    else if (q.includeSuperseded !== 'true') conds.push(ne(documents.status, 'superseded'));
    if (q.docType) conds.push(eq(documents.docType, q.docType as Row['docType']));
    if (q.q) conds.push(or(like(documents.title, `%${q.q}%`), like(documents.originalName, `%${q.q}%`))!);
    const where = and(...conds);
    const sort = parseSort<'createdAt' | 'title'>(q.sort, 'createdAt');
    const col = sort.field === 'title' ? documents.title : documents.createdAt;
    const descending = q.sort ? sort.desc : true;
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(documents).where(where),
      this.select().where(where).orderBy(descending ? desc(col) : asc(col), desc(documents.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(rows.map(toDto), q.page, q.pageSize, Number(total?.n ?? 0)) satisfies Paginated<DocumentDto>;
  }

  async get(ctx: RequestContext, id: number): Promise<DocumentDto> {
    await this.visible(ctx, id);
    const [row] = await this.select().where(eq(documents.id, id));
    return toDto(row!);
  }

  async chunks(ctx: RequestContext, id: number): Promise<DocumentChunkDto[]> {
    await this.visible(ctx, id);
    const rows = await this.db.select().from(documentChunks).where(and(eq(documentChunks.documentId, id), eq(documentChunks.orgId, ctx.orgId))).orderBy(asc(documentChunks.seq));
    return rows.map((c) => ({ id: c.id, seq: c.seq, page: c.page, section: c.section, content: c.content }));
  }

  async upload(ctx: RequestContext, file: UploadedFile, input: DocumentUploadInput, req: Request, replacesId?: number): Promise<DocumentDto> {
    if (!this.readable(ctx).includes(input.classification)) {
      throw AppError.forbidden(`You can't file a document as ${CLASSIFICATION_LABELS[input.classification]}, because you couldn't open it afterwards`);
    }
    if (file.buffer.length === 0) throw AppError.validation('The file is empty', [{ path: 'file', message: 'Empty file' }]);
    const ext = extname(file.originalName).toLowerCase();
    if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `Upload a PDF, Word (.docx), text, Markdown or CSV file`);
    }
    // Trust the bytes, not the name: a renamed executable must not become a "PDF".
    const detected = await fileTypeFromBuffer(file.buffer);
    let mime: string;
    if (ext === '.pdf' && detected?.mime === 'application/pdf') mime = detected.mime;
    else if (ext === '.docx' && detected?.mime === DOCX) mime = DOCX;
    else if (TEXT_MIME[ext] && !detected && looksLikeText(file.buffer)) mime = TEXT_MIME[ext]!;
    else throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `The file's content doesn't match its ${ext} extension`);

    let previous: Row | undefined;
    if (replacesId) {
      previous = await this.visible(ctx, replacesId);
      if (previous.status === 'superseded') throw AppError.businessRule('A newer version of this document already exists; replace that one instead');
    }

    const now = new Date();
    const storageKey = `${ctx.orgId}/documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${ext}`;
    const fullPath = this.pathFor(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.buffer, { flag: 'wx' });

    let id: number;
    try {
      id = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(documents)
          .values({
            orgId: ctx.orgId,
            title: input.title,
            classification: input.classification,
            docType: input.docType,
            originalName: sanitiseName(file.originalName, ext.slice(1)),
            mime,
            sizeBytes: file.buffer.length,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            storageKey,
            version: previous ? previous.version + 1 : 1,
            replacesId: previous?.id ?? null,
            uploadedBy: ctx.userId,
          })
          .$returningId();
        if (previous) {
          // The old version stays in the library's history but is no longer searched.
          await tx.update(documents).set({ status: 'superseded', progress: 100 }).where(eq(documents.id, previous.id));
          await tx.delete(documentChunks).where(eq(documentChunks.documentId, previous.id));
        }
        await audit(tx, req, {
          action: previous ? 'document.replaced' : 'document.uploaded',
          entityType: 'document',
          entityId: created!.id,
          summary: `${input.title} (${CLASSIFICATION_LABELS[input.classification]}${previous ? `, version ${previous.version + 1}` : ''})`,
        });
        return created!.id;
      });
    } catch (err) {
      await rm(fullPath, { force: true });
      throw err;
    }
    if (previous) void this.forgetQuietly(ctx.orgId, previous.id);
    void this.dispatch(ctx.orgId, id);
    return this.get(ctx, id);
  }

  async reprocess(ctx: RequestContext, id: number, req: Request): Promise<DocumentDto> {
    const row = await this.visible(ctx, id);
    if (row.status === 'superseded') throw AppError.businessRule('This is an old version; reprocess the current one');
    await this.db.update(documents).set({ status: 'queued', progress: 0, error: null }).where(eq(documents.id, id));
    await audit(this.db, req, { action: 'document.reprocessed', entityType: 'document', entityId: id, summary: row.title });
    void this.dispatch(ctx.orgId, id);
    return this.get(ctx, id);
  }

  /** Deletes the document with all its earlier versions: rows, chunks, search vectors and files. */
  async remove(ctx: RequestContext, id: number, req: Request): Promise<void> {
    const row = await this.visible(ctx, id);
    const chain: Row[] = [row];
    for (let cur = row; cur.replacesId && chain.length < 100; ) {
      const [prev] = await this.db.select().from(documents).where(and(eq(documents.id, cur.replacesId), eq(documents.orgId, ctx.orgId)));
      if (!prev) break;
      chain.push(prev);
      cur = prev;
    }
    for (const d of chain) await this.forgetQuietly(ctx.orgId, d.id);
    await this.db.transaction(async (tx) => {
      await tx.delete(documents).where(inArray(documents.id, chain.map((d) => d.id)));
      await audit(tx, req, { action: 'document.deleted', entityType: 'document', entityId: id, summary: `${row.title}${chain.length > 1 ? ` and ${chain.length - 1} earlier version(s)` : ''}` });
    });
    for (const d of chain) await rm(this.pathFor(d.storageKey), { force: true });
  }

  async open(ctx: RequestContext, id: number, req: Request) {
    const row = await this.visible(ctx, id);
    const fullPath = this.pathFor(row.storageKey);
    try {
      await stat(fullPath);
    } catch {
      throw AppError.notFound('Document file');
    }
    await audit(this.db, req, { action: 'document.downloaded', entityType: 'document', entityId: row.id, summary: row.title });
    return { row, stream: () => createReadStream(fullPath) };
  }

  /** Asks the RAG service to index a document. If it is unavailable the document stays queued for the retry job. */
  private async dispatch(orgId: number, id: number): Promise<boolean> {
    if (!this.rag.configured) return false;
    try {
      const org = await getOrgInfo(this.db, orgId);
      await this.rag.ingest(systemIdentity(orgId, org.timezone), id);
      return true;
    } catch (err) {
      this.log.warn({ err: (err as Error).message, documentId: id }, 'document service unavailable; ingestion will be retried');
      return false;
    }
  }

  private async forgetQuietly(orgId: number, id: number): Promise<void> {
    if (!this.rag.configured) return;
    try {
      const org = await getOrgInfo(this.db, orgId);
      await this.rag.forget(systemIdentity(orgId, org.timezone), id);
    } catch {
      // Stale vectors are harmless: searches re-check every hit against MySQL before using it.
    }
  }

  /**
   * Background job: hands queued documents to the RAG service and re-queues any stuck in processing
   * (for example after a restart). Small batches keep each run short.
   */
  async dispatchQueued(now = new Date()): Promise<number> {
    if (!this.rag.configured || !(await this.rag.health())) return 0;
    await this.db
      .update(documents)
      .set({ status: 'queued', progress: 0 })
      .where(and(eq(documents.status, 'processing'), lt(documents.updatedAt, new Date(now.getTime() - 10 * 60_000))));
    const queued = await this.db
      .select({ id: documents.id, orgId: documents.orgId })
      .from(documents)
      .innerJoin(organizations, eq(organizations.id, documents.orgId))
      .where(eq(documents.status, 'queued'))
      .orderBy(asc(documents.id))
      .limit(5);
    let sent = 0;
    for (const d of queued) {
      if (await this.dispatch(d.orgId, d.id)) {
        // Mark it so the next run doesn't send it again while the service works through its queue.
        await this.db.update(documents).set({ status: 'processing', progress: 1 }).where(and(eq(documents.id, d.id), eq(documents.status, 'queued')));
        sent++;
      }
    }
    return sent;
  }

  async counts(ctx: RequestContext): Promise<Record<DocumentStatus, number>> {
    const rows = await this.db
      .select({ status: documents.status, n: count() })
      .from(documents)
      .where(and(eq(documents.orgId, ctx.orgId), inArray(documents.classification, this.readable(ctx))))
      .groupBy(documents.status);
    const out = { queued: 0, processing: 0, ready: 0, failed: 0, superseded: 0 } as Record<DocumentStatus, number>;
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
}

function toDto({ d, uploader }: { d: Row; uploader: string | null }): DocumentDto {
  return {
    id: d.id,
    title: d.title,
    classification: d.classification,
    docType: d.docType,
    originalName: d.originalName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    version: d.version,
    replacesId: d.replacesId,
    status: d.status,
    progress: d.progress,
    error: d.error,
    pageCount: d.pageCount,
    chunkCount: d.chunkCount,
    embeddingModel: d.embeddingModel,
    uploadedBy: uploader,
    createdAt: d.createdAt.toISOString(),
    processedAt: d.processedAt?.toISOString() ?? null,
  };
}

