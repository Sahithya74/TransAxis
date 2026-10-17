import { and, desc, eq } from 'drizzle-orm';
import { aiQueries, type Db } from '@transaxis/database';
import type { AiAnswerDto, AiAskInput, AiQueryDto, AiStatusDto } from '@transaxis/shared';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { getOrgInfo } from '../../lib/org.js';
import { identityFor, RagUnavailableError, type RagClient } from '../../lib/rag.js';

/**
 * The assistant. Questions go to the RAG service with the asker's own permissions; every question and
 * how it was answered (route, mode, citations, figures, warnings) is kept in `ai_queries`.
 */
export class AiService {
  constructor(
    private readonly db: Db,
    private readonly rag: RagClient,
  ) {}

  async status(ctx: RequestContext): Promise<AiStatusDto> {
    const health = await this.rag.health();
    if (!health) {
      return {
        available: false,
        mode: 'mock',
        model: null,
        embedding: null,
        documentsReady: 0,
        message: this.rag.configured
          ? "The document service isn't running, so the assistant is unavailable. Start it with npm run dev (or npm run rag)."
          : "The document service isn't configured: set RAG_SERVICE_URL and RAG_SERVICE_SECRET.",
      };
    }
    const org = await getOrgInfo(this.db, ctx.orgId);
    const s = await this.rag.status(identityFor(ctx, org.timezone)).catch(() => null);
    return {
      available: true,
      mode: health.llm,
      model: health.model,
      embedding: health.embedding,
      documentsReady: s?.documentsReady ?? 0,
      message:
        health.llm === 'mock'
          ? 'Answers quote your documents and figures as they are, without a language model. Set ANTHROPIC_API_KEY on the server to answer with Claude.'
          : null,
    };
  }

  async ask(ctx: RequestContext, input: AiAskInput, accessToken: string | null): Promise<AiAnswerDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    let res: Omit<AiAnswerDto, 'id'>;
    try {
      res = await this.rag.ask(identityFor(ctx, org.timezone, accessToken), input);
    } catch (err) {
      if (err instanceof RagUnavailableError) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', "The assistant isn't available right now because the document service isn't running.");
      }
      throw err;
    }
    const [row] = await this.db
      .insert(aiQueries)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        question: input.question,
        route: res.route,
        mode: res.mode,
        model: res.model,
        answer: res.answer,
        period: res.period,
        citations: res.citations,
        structured: res.structured,
        warnings: res.warnings,
        latencyMs: res.latencyMs,
      })
      .$returningId();
    return { ...res, id: row!.id };
  }

  /** The caller's own recent questions. Nobody else's questions are listed here. */
  async history(ctx: RequestContext): Promise<AiQueryDto[]> {
    const rows = await this.db
      .select({ id: aiQueries.id, question: aiQueries.question, route: aiQueries.route, mode: aiQueries.mode, createdAt: aiQueries.createdAt })
      .from(aiQueries)
      .where(and(eq(aiQueries.orgId, ctx.orgId), eq(aiQueries.userId, ctx.userId)))
      .orderBy(desc(aiQueries.createdAt), desc(aiQueries.id))
      .limit(20);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}
