import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Upload } from 'lucide-react';
import { EXCHANGE_LABELS, MAX_IMPORT_ROWS, type ExchangeEntity, type ImportResultDto, type Permission } from '@transaxis/shared';
import { useAuth } from '../auth/AuthProvider';
import { api, download } from '../lib/api';
import { apiFieldErrors } from '../lib/forms';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { useToast } from './ui/Toast';

const PERMS: Record<ExchangeEntity, { read: Permission; write: Permission }> = {
  vehicles: { read: 'vehicles:read', write: 'vehicles:write' },
  workers: { read: 'workers:read', write: 'workers:write' },
  customers: { read: 'customers:read', write: 'customers:write' },
};
const MAX_BYTES = 900_000;

const STATUS: Record<ImportResultDto['rows'][number]['status'], { tone: 'ok' | 'warn' | 'crit' | 'neutral'; label: string }> = {
  create: { tone: 'ok', label: 'New' },
  created: { tone: 'ok', label: 'Added' },
  skip: { tone: 'neutral', label: 'Exists' },
  error: { tone: 'crit', label: 'Error' },
  failed: { tone: 'crit', label: 'Failed' },
};

function ImportDialog({ entity, open, onClose }: { entity: ExchangeEntity; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = EXCHANGE_LABELS[entity];

  const reset = () => {
    setFileName(null);
    setCsv(null);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  async function send(text: string, commit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportResultDto>(`/exchange/${entity}/import`, { method: 'POST', body: { csv: text, commit } });
      setResult(res);
      if (res.committed) {
        void qc.invalidateQueries({ queryKey: [entity] });
        toast.success(`Imported ${res.created} ${label}${res.skipped ? `; ${res.skipped} already existed` : ''}`);
      }
    } catch (err) {
      setResult(null);
      setError(apiFieldErrors(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 900 KB. Split it into smaller files.');
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    await send(text, false);
  }

  const problems = result?.rows.filter((r) => r.status !== 'create' && r.status !== 'created') ?? [];
  const canCommit = !!csv && !!result && !result.committed && result.errors === 0 && result.toCreate > 0;

  return (
    <Dialog
      open={open}
      onClose={close}
      width="lg"
      title={`Import ${label}`}
      description={`Upload a CSV file. Nothing is saved until you confirm, and records that already exist are left as they are. Up to ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows.`}
      footer={
        result?.committed ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!canCommit} loading={busy && !!result} onClick={() => csv && void send(csv, true)}>
              {result && result.toCreate > 0 ? `Import ${result.toCreate} new ${result.toCreate === 1 ? 'record' : 'records'}` : 'Import'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id={`import-${entity}`} onChange={(e) => void onFile(e.target.files?.[0])} />
          <label
            htmlFor={`import-${entity}`}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-line bg-surface px-3.5 text-sm font-medium hover:border-line-strong hover:bg-canvas focus-within:ring-2"
          >
            <FileUp className="size-4" aria-hidden /> {fileName ? 'Choose another file' : 'Choose a CSV file'}
          </label>
          {fileName && <span className="truncate text-muted">{fileName}</span>}
          <button
            type="button"
            className="ml-auto text-primary hover:underline"
            onClick={() => void download(`/exchange/${entity}/template.csv`, {}, `${entity}-import-template.csv`).catch((e: Error) => toast.error(e.message))}
          >
            Download the template
          </button>
        </div>
        <p className="text-xs text-muted">
          Use the column names from the template (or an export). Dates can be written as 2025-04-01 or 01/04/2025 (day first). Spreadsheet apps can save
          as “CSV UTF-8”.
        </p>

        {busy && !result && <p role="status">Checking the file…</p>}
        {error && (
          <p role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-crit-strong">
            {error}
          </p>
        )}

        {result && (
          <div aria-live="polite" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge>{result.total} rows</Badge>
              {result.committed ? <Badge tone="ok">{result.created} added</Badge> : <Badge tone="ok">{result.toCreate} new</Badge>}
              {result.skipped > 0 && <Badge>{result.skipped} already exist</Badge>}
              {result.errors > 0 && <Badge tone="crit">{result.errors} with errors</Badge>}
            </div>
            {result.warnings.map((w) => (
              <p key={w} className="rounded border border-warn/40 bg-warn-soft px-3 py-2 text-warn-strong">
                {w}
              </p>
            ))}
            {result.errors > 0 && !result.committed && <p>Fix these rows in your spreadsheet and choose the file again. Nothing has been saved.</p>}
            {problems.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded border border-line">
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 bg-canvas text-muted">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Line</th>
                      <th className="px-3 py-1.5 font-medium">Record</th>
                      <th className="px-3 py-1.5 font-medium">Result</th>
                      <th className="px-3 py-1.5 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.slice(0, 200).map((r) => (
                      <tr key={r.line} className="border-t border-line align-top">
                        <td className="px-3 py-1.5 tabular-nums">{r.line}</td>
                        <td className="px-3 py-1.5 font-mono">{r.key ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                        </td>
                        <td className="px-3 py-1.5">{r.messages.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {problems.length > 200 && <p className="border-t border-line px-3 py-1.5 text-muted">And {problems.length - 200} more rows.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Export and Import buttons for a list page; each shows only with the matching permission. */
export function CsvExchange({ entity }: { entity: ExchangeEntity }) {
  const { can } = useAuth();
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const perms = PERMS[entity];

  return (
    <>
      {can(perms.read) && (
        <Button
          loading={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await download(`/exchange/${entity}/export.csv`, {}, `${entity}.csv`);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          <Download className="size-4" aria-hidden /> Export
        </Button>
      )}
      {can(perms.write) && (
        <>
          <Button onClick={() => setImporting(true)}>
            <Upload className="size-4" aria-hidden /> Import
          </Button>
          <ImportDialog entity={entity} open={importing} onClose={() => setImporting(false)} />
        </>
      )}
    </>
  );
}
