import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, Eye, FilePlus2, FileText, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import {
  CLASSIFICATION_LABELS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  readableClassifications,
  type DocumentClassification,
  type DocumentDto,
  type DocumentType,
} from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Drawer } from '../../components/ui/Drawer';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { download } from '../../lib/api';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDateTime, fmtNumber } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useDocument, useDocumentChunks, useDocumentMutations, useDocuments, useDocumentSummary } from './api';
import { ClassificationBadge, DOCUMENT_STATUS_LABEL, DocumentStatusBadge, fmtBytes } from './labels';

export function DocumentsPage() {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const lp = useListParams(['q', 'classification', 'status', 'docType', 'view'] as const);
  const [search, setSearch] = useState(lp.values.q ?? '');
  const [uploading, setUploading] = useState<{ replaces?: DocumentDto } | null>(null);
  const [deleting, setDeleting] = useState<DocumentDto | null>(null);
  const viewing = Number(lp.values.view) || null;
  const readable = readableClassifications((p) => can(p));
  const write = can('documents:write');
  const summary = useDocumentSummary();
  const list = useDocuments({ page: lp.page, pageSize: 25, sort: lp.sort, q: lp.values.q, classification: lp.values.classification, status: lp.values.status, docType: lp.values.docType });
  const { reprocess, remove } = useDocumentMutations();

  const save = (d: DocumentDto) => download(`/documents/${d.id}/download`, {}, d.originalName).catch((e: Error) => toast.error(e.message));

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Policies, contracts, SOPs and rate sheets. The assistant answers from the documents you can open, and cites them."
        actions={write && <Button variant="primary" onClick={() => setUploading({})}><Upload className="size-4" aria-hidden /> Upload document</Button>}
      />
      {summary.data && summary.data.failed > 0 && (
        <Banner tone="warn" title={`${summary.data.failed} document${summary.data.failed === 1 ? '' : 's'} could not be read`}>
          Open them to see why, then upload a better copy or reprocess.
        </Banner>
      )}
      <Card>
        <form
          role="search"
          className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            lp.update({ q: search.trim() || undefined });
          }}
        >
          <div className="relative min-w-52 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
            <Input aria-label="Search documents" placeholder="Title or file name…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Classification" className="w-auto" value={lp.values.classification ?? ''} onChange={(e) => lp.update({ classification: e.target.value || undefined })}>
            <option value="">Any classification</option>
            {readable.map((c) => <option key={c} value={c}>{CLASSIFICATION_LABELS[c]}</option>)}
          </Select>
          <Select aria-label="Type" className="w-auto" value={lp.values.docType ?? ''} onChange={(e) => lp.update({ docType: e.target.value || undefined })}>
            <option value="">Any type</option>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
          </Select>
          <Select aria-label="Status" className="w-auto" value={lp.values.status ?? ''} onChange={(e) => lp.update({ status: e.target.value || undefined })}>
            <option value="">Current versions</option>
            {DOCUMENT_STATUSES.map((s) => <option key={s} value={s}>{DOCUMENT_STATUS_LABEL[s]}{summary.data ? ` (${summary.data[s]})` : ''}</option>)}
          </Select>
        </form>
        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={980}>
            <THead>
              <Th>Document</Th>
              <Th>Classification</Th>
              <Th>Status</Th>
              <Th>Content</Th>
              <Th>Uploaded</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </THead>
            <tbody aria-busy={list.isFetching}>
              {list.isPending &&
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-b border-subtle">
                    {Array.from({ length: 6 }, (__, j) => <td key={j} className="h-12 px-4"><Skeleton className="h-3.5 w-24" /></td>)}
                  </tr>
                ))}
              {list.data?.data.map((d) => (
                <tr key={d.id} className="border-b border-subtle align-top">
                  <td className="px-4 py-3">
                    <button className="flex items-start gap-2 text-left" onClick={() => lp.update({ view: String(d.id) })}>
                      <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                      <span>
                        <span className="font-medium text-primary hover:underline">{d.title}</span>
                        <span className="block text-xs text-muted">{d.originalName}{d.version > 1 ? ` · version ${d.version}` : ''} · {DOCUMENT_TYPE_LABELS[d.docType]}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3"><ClassificationBadge value={d.classification} /></td>
                  <td className="px-4 py-3">
                    <DocumentStatusBadge status={d.status} />
                    {d.status === 'processing' && (
                      <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Processing progress">
                        <div className="h-full bg-primary transition-all" style={{ width: `${d.progress}%` }} />
                      </div>
                    )}
                    {d.status === 'queued' && <div className="mt-1 text-xs text-muted">Waiting for the document service</div>}
                    {d.error && <div className="mt-1 max-w-56 text-xs text-crit-strong">{d.error}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {fmtBytes(d.sizeBytes)}
                    {d.pageCount ? ` · ${d.pageCount} pages` : ''}
                    {d.status === 'ready' && <div>{fmtNumber(d.chunkCount)} passages</div>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {d.uploadedBy ?? '—'}
                    <div className="text-muted">{fmtDateTime(d.createdAt, tz)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" aria-label={`View ${d.title}`} onClick={() => lp.update({ view: String(d.id) })}><Eye className="size-4" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Download ${d.title}`} onClick={() => void save(d)}><Download className="size-4" /></Button>
                      {write && d.status !== 'superseded' && (
                        <>
                          <Button size="sm" variant="ghost" aria-label={`Upload a new version of ${d.title}`} onClick={() => setUploading({ replaces: d })}><FilePlus2 className="size-4" /></Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Reprocess ${d.title}`}
                            disabled={d.status === 'queued' || d.status === 'processing'}
                            onClick={() => reprocess.mutateAsync(d.id).then(() => toast.success(`${d.title} will be processed again`), (e: Error) => toast.error(e.message))}
                          >
                            <RefreshCw className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={`Delete ${d.title}`} onClick={() => setDeleting(d)}><Trash2 className="size-4" /></Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && list.data.data.length === 0 && <EmptyState title="No documents" body={write ? 'Upload policies, contracts, SOPs or rate sheets (PDF, Word, text or CSV).' : 'Documents you are allowed to open will appear here.'} />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
        )}
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          You see the classifications your role may open: {readable.map((c) => CLASSIFICATION_LABELS[c]).join(', ')}. The assistant searches exactly the same set.
        </p>
      </Card>
      <UploadDialog state={uploading} classifications={readable} onClose={() => setUploading(null)} />
      <DocumentViewer id={viewing} onClose={() => lp.update({ view: undefined })} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.title ?? ''}?`}
        description="The file, every earlier version and its search index are removed. The assistant can no longer cite it. This can't be undone."
        confirmLabel="Delete document"
        danger
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          toast.success('Document deleted');
        }}
      />
    </div>
  );
}

function UploadDialog({ state, classifications, onClose }: { state: { replaces?: DocumentDto } | null; classifications: DocumentClassification[]; onClose: () => void }) {
  const toast = useToast();
  const { upload } = useDocumentMutations();
  const replaces = state?.replaces;
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [classification, setClassification] = useState<DocumentClassification>('general');
  const [docType, setDocType] = useState<DocumentType>('policy');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = !!state && !wasOpen.current;
    wasOpen.current = !!state;
    if (!opening) return;
    setFile(null);
    setTitle(replaces?.title ?? '');
    setClassification(replaces?.classification ?? classifications[0] ?? 'general');
    setDocType(replaces?.docType ?? 'policy');
    setErrors({});
    setMessage(null);
  }, [state, replaces, classifications]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setErrors({ file: 'Choose a file' });
    const form = new FormData();
    form.set('title', title.trim() || file.name.replace(/\.[^.]+$/, ''));
    form.set('classification', classification);
    form.set('docType', docType);
    form.set('file', file);
    setErrors({});
    setMessage(null);
    try {
      const d = await upload.mutateAsync({ form, replaces: replaces?.id });
      toast.success(replaces ? `Version ${d.version} of ${d.title} uploaded; it is being processed` : `${d.title} uploaded; it is being processed`);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(Object.keys(r.fields).length ? null : r.message);
    }
  }

  return (
    <Dialog
      open={!!state}
      onClose={onClose}
      title={replaces ? `New version of ${replaces.title}` : 'Upload a document'}
      description={replaces ? 'The current version is kept in the history but no longer searched.' : 'PDF, Word (.docx), text, Markdown or CSV. Scanned PDFs without text cannot be read.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="doc-upload-form" loading={upload.isPending}>Upload</Button>
        </>
      }
    >
      <form id="doc-upload-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Banner tone="crit" title="Couldn’t upload">{message}</Banner></div>}
        <Field label="File" required error={errors.file} className="sm:col-span-2">
          {(p) => (
            <input
              id={p.id}
              aria-describedby={p['aria-describedby']}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv"
              className="block w-full text-[13px] file:mr-3 file:rounded file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px]"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
              }}
            />
          )}
        </Field>
        <Field label="Title" required error={errors.title} className="sm:col-span-2">
          {(p) => <Input {...p} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Classification" required error={errors.classification} hint="Who may open it, and so who the assistant may quote it to">
          {(p) => (
            <Select {...p} value={classification} onChange={(e) => setClassification(e.target.value as DocumentClassification)}>
              {classifications.map((c) => <option key={c} value={c}>{CLASSIFICATION_LABELS[c]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Type" error={errors.docType}>
          {(p) => (
            <Select {...p} value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
            </Select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** The extracted passages of a document, as the assistant sees them. Opens on a cited passage when given. */
export function DocumentViewer({ id, chunkId, onClose }: { id: number | null; chunkId?: number | null; onClose: () => void }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const doc = useDocument(id);
  const chunks = useDocumentChunks(id);
  useEffect(() => {
    if (chunkId && chunks.data) document.getElementById(`chunk-${chunkId}`)?.scrollIntoView({ block: 'center' });
  }, [chunkId, chunks.data]);
  const d = doc.data;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={d?.title ?? 'Document'}
      description={d && <span className="flex flex-wrap items-center gap-2"><ClassificationBadge value={d.classification} /> <DocumentStatusBadge status={d.status} /> {d.originalName}</span>}
      footer={d && <Button onClick={() => void download(`/documents/${d.id}/download`, {}, d.originalName).catch((e: Error) => toast.error(e.message))}><Download className="size-4" aria-hidden /> Download original</Button>}
    >
      {doc.isError ? (
        <ErrorState message={(doc.error as Error).message} />
      ) : !d ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-4 text-[13px]">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div><dt className="text-xs text-muted">Type</dt><dd>{DOCUMENT_TYPE_LABELS[d.docType]}</dd></div>
            <div><dt className="text-xs text-muted">Version</dt><dd>{d.version}</dd></div>
            <div><dt className="text-xs text-muted">Uploaded</dt><dd>{d.uploadedBy ?? '—'}, {fmtDateTime(d.createdAt, tz)}</dd></div>
            <div><dt className="text-xs text-muted">Processed</dt><dd>{d.processedAt ? fmtDateTime(d.processedAt, tz) : '—'}{d.embeddingModel ? ` · ${d.embeddingModel}` : ''}</dd></div>
          </dl>
          {d.error && <Banner tone="crit" title="Couldn’t read this document">{d.error}</Banner>}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Searchable passages{chunks.data ? ` (${chunks.data.length})` : ''}</h3>
            {chunks.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : !chunks.data?.length ? (
              <p className="text-muted">{d.status === 'ready' ? 'No text was found.' : 'Passages appear once the document has been processed.'}</p>
            ) : (
              <ol className="space-y-2">
                {chunks.data.map((c) => (
                  <li
                    key={c.id}
                    id={`chunk-${c.id}`}
                    className={`rounded border px-3 py-2 ${c.id === chunkId ? 'border-primary bg-primary-soft' : 'border-line'}`}
                  >
                    <div className="mb-1 text-xs text-muted">
                      Passage {c.seq + 1}
                      {c.page ? ` · page ${c.page}` : ''}
                      {c.section ? ` · ${c.section}` : ''}
                    </div>
                    <p className="whitespace-pre-line">{c.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
