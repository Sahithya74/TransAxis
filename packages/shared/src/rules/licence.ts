import type { LicenceClass } from '../enums.js';

/**
 * Which vehicle classes each licence class may drive.
 *
 * Assumption (documented in docs/assumptions.md): a higher transport class authorises the lower
 * transport classes beneath it, but a trailer / articulated endorsement is always explicit. Orgs with
 * stricter policies can record every class held on the licence; this table only ever *adds* cover.
 */
export const LICENCE_COVERAGE: Record<LicenceClass, readonly LicenceClass[]> = {
  LMV: ['LMV'],
  'LMV-TR': ['LMV-TR', 'LMV'],
  MGV: ['MGV', 'LMV-TR', 'LMV'],
  HGMV: ['HGMV', 'MGV', 'LMV-TR', 'LMV'],
  HPMV: ['HPMV', 'LMV-TR', 'LMV'],
  HTV: ['HTV', 'HGMV', 'HPMV', 'MGV', 'LMV-TR', 'LMV'],
  TRAILER: ['TRAILER'],
};

/** True if any held class authorises driving a vehicle that requires `required`. */
export function licenceCovers(held: readonly string[], required: string): boolean {
  return held.some((h) => (LICENCE_COVERAGE[h as LicenceClass] ?? [h]).includes(required as LicenceClass));
}
