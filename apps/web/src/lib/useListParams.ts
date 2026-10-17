import { useSearchParams } from 'react-router';

/**
 * List filters, sort and page kept in the URL so views can be bookmarked and shared.
 * Changing any filter resets to page 1.
 */
export function useListParams<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? undefined])) as Record<K, string | undefined>;
  const page = Number(params.get('page') ?? 1) || 1;
  const sort = params.get('sort') ?? undefined;

  const update = (patch: Partial<Record<K | 'sort' | 'page', string | undefined>>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const active = keys.some((k) => k !== 'tab' && values[k]);
  return { values, page, sort, update, clear, active };
}
