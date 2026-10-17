import { z } from 'zod';
import {
  DOCUMENT_CLASSIFICATIONS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  type AiMode,
  type AiRoute,
  type DocumentClassification,
  type DocumentStatus,
  type DocumentType,
} from '../enums-docs.js';
import { listQuerySchema } from './common.js';

// ------------------------------------------------------------------ document library

/** Multipart fields sent with an upload (the file itself travels as `file`). */
export const documentUploadSchema = z.object({
  title: z.string().trim().min(3, 'Give the document a title').max(200),
  classification: z.enum(DOCUMENT_CLASSIFICATIONS),
  docType: z.enum(DOCUMENT_TYPES).default('other'),
});
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;

export const documentListQuerySchema = listQuerySchema(['createdAt', 'title'] as const).extend({
  classification: z.enum(DOCUMENT_CLASSIFICATIONS).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  docType: z.enum(DOCUMENT_TYPES).optional(),
  /** Older versions are hidden unless asked for. */
  includeSuperseded: z.enum(['true', 'false']).optional(),
});

export interface DocumentDto {
  id: number;
  title: string;
  classification: DocumentClassification;
  docType: DocumentType;
  originalName: string;
  mime: string;
  sizeBytes: number;
  version: number;
  replacesId: number | null;
  status: DocumentStatus;
  progress: number;
  error: string | null;
  pageCount: number | null;
  chunkCount: number;
  embeddingModel: string | null;
  uploadedBy: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface DocumentChunkDto {
  id: number;
  seq: number;
  page: number | null;
  section: string | null;
  content: string;
}

// ------------------------------------------------------------------ AI assistant

export const aiAskSchema = z.object({
  question: z.string().trim().min(3, 'Ask a question').max(1000),
  /** The last few turns, so follow-ups such as "and last month?" make sense. */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(6)
    .default([]),
});
export type AiAskInput = z.infer<typeof aiAskSchema>;

export interface AiCitation {
  /** The [n] marker used in the answer text. */
  index: number;
  chunkId: number;
  documentId: number;
  title: string;
  filename: string;
  page: number | null;
  section: string | null;
  snippet: string;
  score: number;
}

export interface AiStructuredResult {
  metric: string;
  params: Record<string, string | number | null>;
  value: string;
  /** Where the figure can be checked in the app. */
  link: string | null;
}

export interface AiClarification {
  question: string;
  options: { label: string; question: string }[];
}

export interface AiAnswerDto {
  id: number | null;
  answer: string;
  route: AiRoute;
  period: { from: string; to: string; label: string } | null;
  citations: AiCitation[];
  structured: AiStructuredResult[];
  clarification: AiClarification | null;
  mode: AiMode;
  model: string | null;
  warnings: string[];
  latencyMs: number;
}

export interface AiStatusDto {
  available: boolean;
  mode: AiMode;
  model: string | null;
  embedding: string | null;
  documentsReady: number;
  message: string | null;
}

export interface AiQueryDto {
  id: number;
  question: string;
  route: AiRoute;
  mode: AiMode;
  createdAt: string;
}
