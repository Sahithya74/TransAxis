import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowUpRight, Bot, FileText, History, RotateCcw, Send } from 'lucide-react';
import type { AiAnswerDto, AiRoute } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Field';
import { Card, PageHeader, Skeleton } from '../../components/ui/Layout';
import { apiFieldErrors } from '../../lib/forms';
import { fmtRelative } from '../../lib/format';
import { useAiHistory, useAiStatus, useAsk } from '../documents/api';
import { DocumentViewer } from '../documents/DocumentsPage';

interface Exchange {
  id: number;
  question: string;
  answer?: AiAnswerDto;
  error?: string;
}

const ROUTE_LABEL: Record<AiRoute, string> = {
  document: 'From your documents',
  structured: 'From your records',
  hybrid: 'Documents and records',
  clarify: 'Needs more detail',
};

let nextId = 1;

export function AssistantPage() {
  const { can } = useAuth();
  const status = useAiStatus();
  const history = useAiHistory();
  const ask = useAsk();
  const [thread, setThread] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState('');
  const [viewer, setViewer] = useState<{ documentId: number; chunkId: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would take for a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [thread]);

  async function send(question: string) {
    const q = question.trim();
    if (q.length < 3 || ask.isPending) return;
    const id = nextId++;
    // The last few exchanges travel with the question, so "and last month?" makes sense.
    const turns = thread
      .filter((e) => e.answer)
      .slice(-3)
      .flatMap((e) => [
        { role: 'user' as const, content: e.question },
        { role: 'assistant' as const, content: e.answer!.answer.slice(0, 4000) },
      ]);
    setThread((t) => [...t, { id, question: q }]);
    setDraft('');
    try {
      const answer = await ask.mutateAsync({ question: q, history: turns });
      setThread((t) => t.map((e) => (e.id === id ? { ...e, answer } : e)));
    } catch (err) {
      setThread((t) => t.map((e) => (e.id === id ? { ...e, error: apiFieldErrors(err).message } : e)));
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const s = status.data;
  const starters = [
    'What is the driver food allowance per day?',
    can('finance:read') && 'What were our revenue and profit last month?',
    can('finance:read') && 'Which customers owe us the most?',
    can('trips:read') && 'What does the hazardous cargo SOP say about SOS?',
    can('reports:read') && 'Are we within the fuel policy limit this month?',
    can('alerts:read') && 'How many open safety alerts are there?',
  ].filter(Boolean) as string[];

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">AI assistant {s && <ModeBadge mode={s.mode} model={s.model} available={s.available} />}</span>}
        subtitle="Ask about your policies, contracts and procedures, or your own figures. Every answer shows where it came from."
      />
      {s && !s.available && <Banner tone="crit" title="The assistant is unavailable">{s.message}</Banner>}
      {s?.available && s.mode === 'mock' && <Banner tone="info" title="Mock mode">{s.message}</Banner>}

      <div className="grid gap-5 xl:grid-cols-[1fr_18rem]">
        <Card className="flex min-h-[32rem] flex-col">
          <div className="flex-1 space-y-5 p-5" aria-live="polite">
            {thread.length === 0 ? (
              <div className="py-6 text-center">
                <Bot className="mx-auto mb-3 size-9 text-ai" aria-hidden />
                <p className="font-medium">Ask a question to get started</p>
                <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
                  Answers use only the documents you may open{s ? ` (${s.documentsReady} ready)` : ''} and figures you are allowed to see. Nothing is made up: if the
                  sources don’t cover it, the assistant says so.
                </p>
                <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                  {starters.map((q) => (
                    <button key={q} onClick={() => void send(q)} className="rounded-full border border-line px-3 py-1.5 text-[13px] hover:border-primary hover:text-primary">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              thread.map((e) => <ExchangeView key={e.id} e={e} onAsk={(q) => void send(q)} onCite={(documentId, chunkId) => setViewer({ documentId, chunkId })} />)
            )}
            <div ref={endRef} />
          </div>
          <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line bg-canvas p-3">
            <div className="flex-1">
              <label htmlFor="ask" className="sr-only">Your question</label>
              <Textarea
                id="ask"
                rows={2}
                maxLength={1000}
                value={draft}
                placeholder="For example: What is the detention charge for Coromandel?"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                disabled={!!s && !s.available}
                className="min-h-0 resize-none"
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted">
                <span>Enter to ask, Shift+Enter for a new line</span>
                <span>{draft.length}/1000</span>
              </div>
            </div>
            <Button variant="ai" type="submit" loading={ask.isPending} disabled={draft.trim().length < 3 || (!!s && !s.available)} className="mb-5">
              <Send className="size-4" aria-hidden /> Ask
            </Button>
          </form>
        </Card>

        <aside className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><History className="size-4 text-muted" aria-hidden /> Your recent questions</h2>
            {history.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : !history.data?.length ? (
              <p className="text-[13px] text-muted">Questions you ask appear here.</p>
            ) : (
              <ul className="space-y-1">
                {history.data.filter((h, i, all) => all.findIndex((x) => x.question === h.question) === i).slice(0, 10).map((h) => (
                  <li key={h.id}>
                    <button onClick={() => void send(h.question)} className="w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-subtle">
                      <span className="line-clamp-2">{h.question}</span>
                      <span className="text-[11px] text-muted">{fmtRelative(h.createdAt)} · {ROUTE_LABEL[h.route]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 text-[13px] text-muted">
            <h2 className="mb-2 text-[13px] font-semibold text-ink">How answers are made</h2>
            <ul className="list-disc space-y-1 pl-4">
              <li>Document answers quote passages you can open, with numbered sources.</li>
              <li>Figures come from the same reports you see in the app, with your permissions.</li>
              <li>Text inside documents is never treated as instructions.</li>
              <li>Every question is recorded for audit.</li>
            </ul>
          </Card>
        </aside>
      </div>

      <DocumentViewer id={viewer?.documentId ?? null} chunkId={viewer?.chunkId} onClose={() => setViewer(null)} />
    </div>
  );
}

function ModeBadge({ mode, model, available }: { mode: 'claude' | 'mock'; model: string | null; available: boolean }) {
  if (!available) return <Badge tone="crit">Unavailable</Badge>;
  return mode === 'claude' ? <Badge tone="ai">Claude{model ? ` · ${model}` : ''}</Badge> : <Badge tone="warn">Mock mode: no language model</Badge>;
}

function ExchangeView({ e, onAsk, onCite }: { e: Exchange; onAsk: (q: string) => void; onCite: (documentId: number, chunkId: number) => void }) {
  const a = e.answer;
  const cite = (n: number) => {
    const c = a?.citations.find((x) => x.index === n);
    if (c) onCite(c.documentId, c.chunkId);
  };
  return (
    <div className="space-y-3">
      <div className="ml-auto max-w-[85%] rounded-lg bg-primary-soft px-4 py-2.5 text-[13px] text-primary-strong">{e.question}</div>
      {e.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-crit/30 bg-crit-soft px-4 py-3 text-[13px] text-crit-strong">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex-1">{e.error}</span>
          <Button size="sm" variant="ghost" onClick={() => onAsk(e.question)}><RotateCcw className="size-4" aria-hidden /> Try again</Button>
        </div>
      ) : !a ? (
        <div className="space-y-2 rounded-lg border border-line px-4 py-3" aria-busy="true">
          <p className="text-[13px] text-muted">Searching your documents and records…</p>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : (
        <div className="rounded-lg border border-line px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="info">{ROUTE_LABEL[a.route]}</Badge>
            <ModeBadge mode={a.mode} model={a.model} available />
            {a.period && <span>{a.period.label} ({a.period.from} to {a.period.to})</span>}
            <span className="ml-auto">{(a.latencyMs / 1000).toFixed(1)} s</span>
          </div>
          <AnswerText text={a.answer} onCite={cite} />
          {a.clarification && (
            <div className="mt-3 flex flex-wrap gap-2">
              {a.clarification.options.map((o) => (
                <Button key={o.label} size="sm" onClick={() => onAsk(o.question)}>{o.label}</Button>
              ))}
            </div>
          )}
          {a.structured.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {a.structured.map((m, i) => (
                <div key={i} className="rounded border border-line bg-canvas px-3 py-2">
                  <div className="text-xs text-muted">{m.metric}</div>
                  <div className="text-[15px] font-semibold tabular-nums">{m.value}</div>
                  {m.link && (
                    <Link to={m.link} className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                      Check in the app <ArrowUpRight className="size-3" aria-hidden />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
          {a.citations.length > 0 && (
            <section className="mt-3">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Sources</h3>
              <ol className="space-y-1.5">
                {a.citations.map((c) => (
                  <li key={c.index}>
                    <button onClick={() => onCite(c.documentId, c.chunkId)} className="flex w-full items-start gap-2 rounded border border-line px-3 py-2 text-left text-[13px] hover:border-primary">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-primary-soft text-[11px] font-semibold text-primary-strong">{c.index}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 font-medium"><FileText className="size-3.5 text-muted" aria-hidden />{c.title}</span>
                        <span className="block text-xs text-muted">{c.filename}{c.page ? ` · page ${c.page}` : ''}{c.section ? ` · ${c.section}` : ''}</span>
                        <span className="mt-1 block text-xs text-ink/80">{c.snippet}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {a.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-warn-strong">
              {a.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Plain text with "- " bullets; [n] markers become buttons that open the cited passage. */
function AnswerText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const inline = (line: string): ReactNode[] =>
    line.split(/(\[\d{1,2}\])/).map((part, i) => {
      const m = /^\[(\d{1,2})\]$/.exec(part);
      if (!m) return <Fragment key={i}>{part}</Fragment>;
      const n = Number(m[1]);
      return (
        <button key={i} onClick={() => onCite(n)} aria-label={`Open source ${n}`} className="mx-0.5 rounded bg-primary-soft px-1 align-super text-[10px] font-semibold text-primary-strong hover:bg-primary hover:text-white">
          {n}
        </button>
      );
    });
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`} className="list-disc space-y-1 pl-5">
          {list.map((l, i) => <li key={i}>{inline(l)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    blocks.push(
      <p key={`p${blocks.length}`} className={line.startsWith('Mock mode:') ? 'text-xs italic text-muted' : line.endsWith(':') ? 'font-medium' : ''}>
        {inline(line)}
      </p>,
    );
  }
  flush();
  return <div className="space-y-2 text-[13px] leading-relaxed">{blocks}</div>;
}
