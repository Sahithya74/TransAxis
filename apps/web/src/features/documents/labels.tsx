import { CLASSIFICATION_LABELS, type DocumentClassification, type DocumentStatus } from '@transaxis/shared';
import { Badge, type Tone } from '../../components/ui/Badge';

const CLASS_TONE: Record<DocumentClassification, Tone> = { general: 'neutral', operations: 'info', finance: 'ai', hr: 'warn', management: 'crit' };
export const ClassificationBadge = ({ value }: { value: DocumentClassification }) => <Badge tone={CLASS_TONE[value]}>{CLASSIFICATION_LABELS[value]}</Badge>;

const STATUS: Record<DocumentStatus, [Tone, string]> = {
  queued: ['neutral', 'Waiting'],
  processing: ['info', 'Processing'],
  ready: ['ok', 'Ready'],
  failed: ['crit', 'Failed'],
  superseded: ['neutral', 'Older version'],
};
export const DOCUMENT_STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[1]])) as Record<DocumentStatus, string>;
export const DocumentStatusBadge = ({ status }: { status: DocumentStatus }) => <Badge tone={STATUS[status][0]}>{STATUS[status][1]}</Badge>;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / (1024 * 102.4)) / 10} MB`;
}
