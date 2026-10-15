import type { Permission } from '../permissions.js';

/**
 * What a stored file is for. The category decides which types may be uploaded and which permissions
 * allow uploading or downloading it (any-of). Trip documents are additionally restricted to the
 * driver's own trips when the caller only holds trips:update_own.
 */
export const FILE_CATEGORIES = ['vehicle_document', 'worker_document', 'trip_document', 'general'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export type AllowedMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

const DOCS: AllowedMime[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export const FILE_CATEGORY_RULES: Record<
  FileCategory,
  { mimes: AllowedMime[]; upload: Permission[]; download: Permission[] }
> = {
  vehicle_document: { mimes: DOCS, upload: ['vehicle_documents:write'], download: ['vehicles:read'] },
  worker_document: { mimes: DOCS, upload: ['workers:sensitive'], download: ['workers:sensitive'] },
  trip_document: {
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    upload: ['trips:dispatch', 'trips:update_own'],
    download: ['trips:read', 'trips:update_own'],
  },
  general: { mimes: DOCS, upload: ['documents:write'], download: ['documents:read'] },
};

export interface FileDto {
  id: number;
  originalName: string;
  mime: string;
  sizeBytes: number;
  category: string;
  createdAt: string;
}
