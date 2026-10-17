import { bigint, char, index, int, json, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { AI_MODES, AI_ROUTES, DOCUMENT_CLASSIFICATIONS, DOCUMENT_STATUSES, DOCUMENT_TYPES, type AiCitation, type AiStructuredResult } from '@transaxis/shared';
import { createdAtCol, dt, idCol, refCol, updatedAtCol } from './common.js';
import { organizations, users } from './core.js';

/**
 * The document library. Files live in the upload store (never served by path); the RAG service parses
 * them into chunks. A replaced document keeps its row as `superseded` so its history stays visible.
 */
export const documents = mysqlTable(
  'documents',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    title: varchar('title', { length: 200 }).notNull(),
    classification: mysqlEnum('classification', DOCUMENT_CLASSIFICATIONS).notNull(),
    docType: mysqlEnum('doc_type', DOCUMENT_TYPES).notNull().default('other'),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mime: varchar('mime', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number', unsigned: true }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    version: int('version').notNull().default(1),
    replacesId: refCol('replaces_id'),
    status: mysqlEnum('status', DOCUMENT_STATUSES).notNull().default('queued'),
    progress: int('progress').notNull().default(0),
    error: varchar('error', { length: 500 }),
    pageCount: int('page_count'),
    chunkCount: int('chunk_count').notNull().default(0),
    embeddingModel: varchar('embedding_model', { length: 80 }),
    uploadedBy: refCol('uploaded_by').references(() => users.id),
    processedAt: dt('processed_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_documents_storage_key').on(t.storageKey),
    index('ix_documents_org_status').on(t.orgId, t.status),
    index('ix_documents_org_class').on(t.orgId, t.classification),
  ],
);

/** Searchable passages. A FULLTEXT index on `content` (migration 0007) gives the keyword half of hybrid search. */
export const documentChunks = mysqlTable(
  'document_chunks',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    documentId: refCol('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    seq: int('seq').notNull(),
    page: int('page'),
    section: varchar('section', { length: 255 }),
    content: text('content').notNull(),
    tokenCount: int('token_count').notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_document_chunks_seq').on(t.documentId, t.seq), index('ix_document_chunks_org').on(t.orgId)],
);

/** Every assistant question and how it was answered, for audit and for the person's own history. */
export const aiQueries = mysqlTable(
  'ai_queries',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: refCol('user_id')
      .notNull()
      .references(() => users.id),
    question: text('question').notNull(),
    route: mysqlEnum('route', AI_ROUTES).notNull(),
    mode: mysqlEnum('mode', AI_MODES).notNull(),
    model: varchar('model', { length: 80 }),
    answer: text('answer').notNull(),
    period: json('period').$type<{ from: string; to: string; label: string } | null>(),
    citations: json('citations').$type<AiCitation[]>().notNull(),
    structured: json('structured').$type<AiStructuredResult[]>().notNull(),
    warnings: json('warnings').$type<string[]>().notNull(),
    latencyMs: int('latency_ms').notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_ai_queries_user').on(t.orgId, t.userId, t.createdAt)],
);
