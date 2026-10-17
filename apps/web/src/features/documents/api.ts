import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiAnswerDto, AiAskInput, AiQueryDto, AiStatusDto, DocumentChunkDto, DocumentDto, DocumentStatus, Paginated } from '@transaxis/shared';
import { api } from '../../lib/api';

type Query = Record<string, string | number | undefined>;

const busy = (docs: DocumentDto[] | undefined) => !!docs?.some((d) => d.status === 'queued' || d.status === 'processing');

export const useDocuments = (q: Query, enabled = true) =>
  useQuery({
    queryKey: ['documents', 'list', q],
    queryFn: ({ signal }) => api<Paginated<DocumentDto>>('/documents', { query: q, signal }),
    placeholderData: keepPreviousData,
    // While anything is being processed, keep its progress moving on screen.
    refetchInterval: (query) => (busy(query.state.data?.data) ? 3000 : false),
    enabled,
  });

export const useDocumentSummary = (enabled = true) =>
  useQuery({ queryKey: ['documents', 'summary'], queryFn: ({ signal }) => api<Record<DocumentStatus, number>>('/documents/summary', { signal }), enabled });

export const useDocument = (id: number | null) =>
  useQuery({ queryKey: ['documents', 'detail', id], queryFn: ({ signal }) => api<DocumentDto>(`/documents/${id}`, { signal }), enabled: !!id });

export const useDocumentChunks = (id: number | null) =>
  useQuery({
    queryKey: ['documents', 'chunks', id],
    queryFn: ({ signal }) => api<{ data: DocumentChunkDto[] }>(`/documents/${id}/chunks`, { signal }).then((r) => r.data),
    enabled: !!id,
  });

export function useDocumentMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['documents'] });
    void qc.invalidateQueries({ queryKey: ['ai', 'status'] });
  };
  return {
    upload: useMutation({
      mutationFn: ({ form, replaces }: { form: FormData; replaces?: number }) =>
        api<DocumentDto>(replaces ? `/documents/${replaces}/versions` : '/documents', { method: 'POST', body: form }),
      onSuccess: refresh,
    }),
    reprocess: useMutation({ mutationFn: (id: number) => api<DocumentDto>(`/documents/${id}/reprocess`, { method: 'POST' }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: number) => api<void>(`/documents/${id}`, { method: 'DELETE' }), onSettled: refresh }),
  };
}

// ------------------------------------------------------------------ assistant

export const useAiStatus = (enabled = true) =>
  useQuery({ queryKey: ['ai', 'status'], queryFn: ({ signal }) => api<AiStatusDto>('/ai/status', { signal }), enabled, refetchInterval: 30_000 });

export const useAiHistory = (enabled = true) =>
  useQuery({ queryKey: ['ai', 'history'], queryFn: ({ signal }) => api<{ data: AiQueryDto[] }>('/ai/history', { signal }).then((r) => r.data), enabled });

export function useAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AiAskInput) => api<AiAnswerDto>('/ai/ask', { method: 'POST', body: input }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['ai', 'history'] }),
  });
}
