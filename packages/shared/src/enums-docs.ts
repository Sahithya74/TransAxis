import type { Permission } from './permissions.js';

/** Enumerations and access rules for the document library and the AI assistant. */

export const DOCUMENT_CLASSIFICATIONS = ['general', 'operations', 'finance', 'hr', 'management'] as const;
export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<DocumentClassification, string> = {
  general: 'General',
  operations: 'Operations',
  finance: 'Finance',
  hr: 'HR (restricted)',
  management: 'Management (restricted)',
};

/**
 * Who may read each classification, on top of `documents:read`. Empty means everyone who can read
 * documents. Retrieval for the AI assistant applies the same rule, so an answer can never quote a
 * document its reader couldn't open.
 */
export const CLASSIFICATION_REQUIRES: Record<DocumentClassification, Permission[]> = {
  general: [],
  operations: ['trips:read'],
  finance: ['finance:read'],
  hr: ['workers:sensitive'],
  management: ['settings:read'],
};

export function readableClassifications(has: (p: Permission) => boolean): DocumentClassification[] {
  if (!has('documents:read')) return [];
  return DOCUMENT_CLASSIFICATIONS.filter((c) => CLASSIFICATION_REQUIRES[c].every((p) => has(p)));
}

export const DOCUMENT_TYPES = ['policy', 'contract', 'sop', 'rate_sheet', 'report', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  policy: 'Policy',
  contract: 'Contract',
  sop: 'Standard operating procedure',
  rate_sheet: 'Rate sheet',
  report: 'Report',
  other: 'Other',
};

/** `superseded`: an older version kept for history; only `ready` documents are searched. */
export const DOCUMENT_STATUSES = ['queued', 'processing', 'ready', 'failed', 'superseded'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Extensions the library accepts; the content is also checked, not just the name. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.csv'] as const;

export const AI_ROUTES = ['document', 'structured', 'hybrid', 'clarify'] as const;
export type AiRoute = (typeof AI_ROUTES)[number];

/** `mock` composes answers from retrieved passages and figures without a language model, and says so. */
export const AI_MODES = ['claude', 'mock'] as const;
export type AiMode = (typeof AI_MODES)[number];
