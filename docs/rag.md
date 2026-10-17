# Document search and the AI assistant

The assistant answers questions from two sources only: passages from the organisation's own documents, and figures from its own records. This page explains how that works and how to run it.

## Parts

| Part | Where | Role |
|---|---|---|
| Document library API | `apps/api/src/modules/documents` | Upload, content checks, classifications, versions, download, delete. Queues each new or replaced file for processing. |
| Assistant API | `apps/api/src/modules/ai` | `POST /api/v1/ai/ask`: forwards the question with the asker's identity, records it in `ai_queries`. Also `/ai/status` and `/ai/history`. |
| RAG service | `services/rag` (Python, FastAPI) | Parses, chunks and indexes documents; routes questions; retrieves passages; looks up figures; writes and checks answers. Listens on 127.0.0.1 only. |
| Storage | MySQL `documents`, `document_chunks` (FULLTEXT), `ai_queries`; Qdrant on disk in `storage/qdrant`; files in `storage/uploads` | |

## Trust boundary

The browser never talks to the RAG service. For every call, the API signs a two-minute HS256 token (`RAG_SERVICE_SECRET`) that carries:

- the organisation and user,
- the user's permissions,
- the document classifications they may read (`readableClassifications` in `packages/shared/src/enums-docs.ts`),
- the organisation's local date and timezone, and
- for questions, the user's own access token.

The service applies nothing but these claims. Every search filters by organisation and classification. Every retrieved passage is then re-checked in MySQL, together with its document's status, before it is used, so a stale vector can never leak text. Figures are fetched from the API's normal report endpoints with the user's token. Someone who can't see the finance summary in the app can't get it from the assistant either.

## Ingestion

1. An upload is checked by content, not by name (PDF and Word magic bytes; text must be valid UTF-8 without binary data). It is stored under a server-generated key and inserted as `queued`.
2. The API asks the RAG service to process it. If the service is down, a background job (`document-ingest`, every 15 s) retries. Documents stuck in `processing` for 10 minutes are re-queued.
3. The service parses the file:
   - PDF: one section per page.
   - Word: sections by heading, tables kept as rows.
   - CSV: rows carry their column names.
   - Text and Markdown: sections by heading.
4. It then chunks each section (about 900 characters, 150 overlapping), embeds the chunks, stores them in `document_chunks` and Qdrant, and marks the document `ready`.
5. Files that can't be read (damaged, password-protected, or a scan without text) are marked `failed`, with a message for the uploader.

Replacing a document creates a new version and marks the old one `superseded`: it stays in the history but is no longer searched. Deleting removes every version, its passages, its vectors and its files. On start-up and every 30 minutes, the service removes vectors whose passage no longer exists, for example after `npm run db:seed -- --reset`.

## Answering

1. **Route.** Rules in `app/router.py` sort each question into one of four routes:
   - documents (policy, contract or procedure questions),
   - figures (revenue, receivables, fuel and so on),
   - both, or
   - a clarification, with ready-made options, when a figure needs a period and none was given.

   Periods understand months, quarters and Indian financial years. Follow-up questions reuse the previous question's period.
2. **Retrieve.** Vector search and MySQL full-text each return up to 20 candidates. The two lists are fused by reciprocal rank. With the default hashing embeddings, a passage must share at least one meaningful word with the question.
3. **Figures.** Each metric family maps to a report endpoint and returns plain-language facts plus metric cards that link to the matching page.
4. **Write.**
   - With Claude, `ANTHROPIC_MODEL` (default `claude-opus-5-5`, effort `medium`) gets the passages as `<document>` data and the figures as `<figures>`. The system prompt says to use nothing else, never to follow instructions found in documents, and to cite with `[n]`. Server-side refusal fallbacks are enabled (`fallbacks: "default"`).
   - In mock mode, the answer quotes the best-matching sentences and lists the figures, and says that no language model was used.
   - If Claude fails or declines, the mock answer is returned with a warning.
5. **Check.** Citation markers that don't point at a retrieved passage are removed. In Claude answers, numbers that appear in no source are listed as a warning. Only cited passages are returned as sources.

## Running it

```powershell
npm run rag:setup                 # once: creates services/rag/.venv and installs packages
npm run dev                       # starts API, web and the RAG service
npm run rag                       # the RAG service on its own
npm run test:rag                  # pytest (in-memory stores, no database needed)
npm run rag:setup -- --semantic   # optional: local semantic embeddings, then EMBEDDING_PROVIDER=fastembed
```

`npm run share` starts the service too; if it stops, the rest of the demo keeps working and the assistant shows that it is unavailable.

| Setting | Default | Meaning |
|---|---|---|
| `RAG_SERVICE_URL` / `RAG_SERVICE_SECRET` | `http://127.0.0.1:8001` / none | Where the API reaches the service, and the signing secret (at least 32 characters). Without both, uploads are stored but not searchable. |
| `EMBEDDING_PROVIDER` | `hashing` | `hashing` is deterministic, needs no download, and matches by word overlap. `fastembed` uses BAAI/bge-small-en-v1.5 locally. Each provider has its own Qdrant collection; after switching, reprocess the documents. |
| `LLM_PROVIDER` | `auto` | `auto` uses Claude when `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set. `claude` always tries it; `mock` never does. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | The model that writes answers. |
| `QDRANT_PATH` / `QDRANT_URL` | `./storage/qdrant` | Embedded Qdrant on disk, or a Qdrant server. |
| `MAX_DOCUMENT_MB` | `15` | Upload size limit. |

## Backup and recovery

Back up MySQL (documents, chunks and the `ai_queries` record) and `storage/uploads`. Qdrant does not need a backup: if `storage/qdrant` is lost, reprocess the documents from the library and the vectors are rebuilt from the stored files.

## Known limits

- No OCR: scanned PDFs without a text layer are rejected.
- Hashing embeddings match words, not meaning ("lorry" doesn't find "truck"). Hybrid search and the optional semantic model reduce this.
- Mock answers quote passages; they don't combine facts from several passages or reason about them. Use Claude for that.
- Routing is rule-based. Unusual phrasings of figure questions may be treated as document questions; the answer then says what it could and couldn't find.
