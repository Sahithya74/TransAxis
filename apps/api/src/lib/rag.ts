import { SignJWT } from 'jose';
import { readableClassifications, todayIn, type AiAnswerDto, type AiAskInput } from '@transaxis/shared';
import type { RequestContext } from './context.js';

export class RagUnavailableError extends Error {}

/** Who a call to the RAG service is made for. The service applies nothing but these claims. */
export interface RagIdentity {
  orgId: number;
  userId: number;
  permissions: string[];
  classifications: string[];
  timezone: string;
  /** The caller's own access token, so metric lookups run with their permissions. */
  accessToken?: string | null;
}

export function identityFor(ctx: RequestContext, timezone: string, accessToken?: string | null): RagIdentity {
  return {
    orgId: ctx.orgId,
    userId: ctx.userId,
    permissions: [...ctx.permissions],
    classifications: readableClassifications((p) => ctx.permissions.has(p)),
    timezone,
    accessToken,
  };
}

/** For background ingestion, which only needs to know the organisation. */
export const systemIdentity = (orgId: number, timezone: string): RagIdentity => ({ orgId, userId: 0, permissions: [], classifications: [], timezone });

export interface RagHealth {
  status: string;
  embedding: string;
  llm: 'claude' | 'mock';
  model: string | null;
}

/**
 * Client for the local RAG service. Every call carries a two-minute HS256 token naming the organisation,
 * permissions and readable classifications; the service is bound to 127.0.0.1 and trusts nothing else.
 */
export class RagClient {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly secret: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return !!this.baseUrl && !!this.secret;
  }

  private async token(id: RagIdentity): Promise<string> {
    return new SignJWT({
      org: id.orgId,
      perms: id.permissions,
      cls: id.classifications,
      tz: id.timezone,
      today: todayIn(id.timezone),
      ...(id.accessToken ? { tok: id.accessToken } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('transaxis-api')
      .setAudience('transaxis-rag')
      .setSubject(String(id.userId))
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(new TextEncoder().encode(this.secret));
  }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, id: RagIdentity, body?: unknown, timeoutMs = 60_000): Promise<T> {
    if (!this.configured) throw new RagUnavailableError('The document service is not configured');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${await this.token(id)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new RagUnavailableError('The document service is not reachable');
    }
    if (!res.ok) throw new RagUnavailableError(`The document service answered ${res.status}`);
    return (await res.json()) as T;
  }

  async health(): Promise<RagHealth | null> {
    if (!this.configured) return null;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? ((await res.json()) as RagHealth) : null;
    } catch {
      return null;
    }
  }

  ingest(id: RagIdentity, documentId: number): Promise<{ accepted: boolean }> {
    return this.call('POST', `/internal/v1/documents/${documentId}/ingest`, id, undefined, 10_000);
  }

  forget(id: RagIdentity, documentId: number): Promise<{ deleted: boolean }> {
    return this.call('DELETE', `/internal/v1/documents/${documentId}`, id, undefined, 20_000);
  }

  status(id: RagIdentity): Promise<{ documentsReady: number; mode: 'claude' | 'mock'; model: string | null; embedding: string }> {
    return this.call('GET', '/internal/v1/status', id, undefined, 5000);
  }

  ask(id: RagIdentity, input: AiAskInput): Promise<Omit<AiAnswerDto, 'id'>> {
    return this.call('POST', '/internal/v1/ask', id, input, 120_000);
  }
}
