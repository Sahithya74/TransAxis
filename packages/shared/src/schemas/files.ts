import type { Permission } from '../permissions.js';

/**
 * What a stored file is for. The category decides which types may be uploaded and which permission
 * is needed to upload or download it.
 */
export const FILE_CATEGORIES = ['vehicle_document', 'general'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export type AllowedMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

export const FILE_CATEGORY_RULES: Record<
  FileCategory,
  { mimes: AllowedMime[]; uploadPermission: Permission; downloadPermission: Permission }
> = {
  vehicle_document: {
    mimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    uploadPermission: 'vehicle_documents:write',
    downloadPermission: 'vehicles:read',
  },
  general: {
    mimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    uploadPermission: 'documents:write',
    downloadPermission: 'documents:read',
  },
};

export interface FileDto {
  id: number;
  originalName: string;
  mime: string;
  sizeBytes: number;
  category: string;
  createdAt: string;
}
