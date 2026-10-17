# TransAxis

Fleet management and transport-operations platform for Indian road-freight companies: vehicles, drivers, bookings, dispatch, trip tracking, cargo security, maintenance, finance and settlements, analytics, and a document-grounded AI assistant.

> **Build status:** all six phases are complete: the foundation; workforce, customers and vendors, bookings, trip planning and the full trip lifecycle, the dispatch board and calendar; live operations (simulated GPS map, ETA, safety alerts, incidents, check-ins, SOS, notifications and the driver app); maintenance, fuel, GST invoicing and collections, expenses, crew settlements, a double-entry ledger, reports and the customer portal; the document library with an AI assistant that answers with citations; and administration (people, roles, settings, audit log, system health, tenants), two-step sign-in, global search and CSV import/export. [docs/feature-status.md](docs/feature-status.md) says exactly what is real, what is simulated, and what needs an outside provider.

## Stack

| Layer | Technology |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router |
| API | Node.js, Express 5, TypeScript, zod validation, JWT access tokens + rotating refresh cookies |
| Database | MySQL 8 via Drizzle ORM; SQL migrations in `database/migrations` |
| Shared | `packages/shared`: permissions, roles, enums, validation schemas, pure business rules (used by API and web) |
| AI / RAG | Python FastAPI service (`services/rag`), embedded Qdrant, MySQL FULLTEXT; answers with Claude or in a labelled mock mode |

```
apps/web          React front end
apps/api          Express REST API (/api/v1)
packages/shared   Shared schemas, permissions and business rules
database          Drizzle schema, SQL migrations, deterministic seed
services/rag      Document search and assistant service (Python, 127.0.0.1 only)
docs              Architecture, database, security, operations, guides, feature status
scripts           Dev launcher and local MySQL helper
```

## Documentation

| Read | For |
|---|---|
| [docs/demo-walkthrough.md](docs/demo-walkthrough.md) | A 20-minute scripted tour with the demo accounts |
| [docs/user-guide.md](docs/user-guide.md) | What each role does, administration, imports |
| [docs/architecture.md](docs/architecture.md) | Components, request flow, sessions, jobs, module map |
| [docs/database-erd.md](docs/database-erd.md) | Tables and relationships by area, conventions, migrations |
| [docs/security.md](docs/security.md) | Controls, what is tested, production checklist |
| [docs/operations.md](docs/operations.md) | Running, monitoring, backup and restore, troubleshooting |
| [docs/rag.md](docs/rag.md) | Document search and the AI assistant |
| [docs/assumptions.md](docs/assumptions.md) | Business and technical assumptions, simulated parts |
| [docs/feature-status.md](docs/feature-status.md) | What is implemented, simulated or a future integration |

## Prerequisites

- Node.js 20.19+ (developed on 24) and npm 10+
- MySQL 8.0+. Either an existing server, or the installed MySQL binaries run as a private dev instance (below).
- Windows PowerShell for the `mysql:*` helper scripts
- Python 3.10+ for the document search and assistant service (optional: everything else works without it)

## First-time setup

```powershell
npm install
copy .env.example .env      # then generate JWT_ACCESS_SECRET and RAG_SERVICE_SECRET (see comments in the file)
```

**Database: choose one option.**

- *Private dev instance (no admin rights needed).* This uses the installed MySQL 8 binaries with a data directory in `%LOCALAPPDATA%\TransAxis\mysql-dev`, on port 3307. It never touches the `MySQL80` Windows service.
  ```powershell
  npm run mysql:init        # once
  npm run mysql:start       # after each reboot
  ```
  Set `MYSQL_PORT=3307` in `.env`. The new root account has no password until you set one; put it in `MYSQL_ADMIN_PASSWORD`.
- *Existing MySQL server or the `MySQL80` service.* Start it, then put its host, port and root password in `.env`.

Then create the schema and demo data:

```powershell
npm run db:bootstrap      # creates transaxis + transaxis_test and a least-privilege app user, writes DATABASE_URL*
npm run db:migrate        # applies SQL migrations
npm run db:seed           # deterministic demo data (add -- --reset to wipe and reseed)
npm run rag:setup         # optional: Python environment for document search and the assistant
```

## Run

```powershell
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000/api/v1 (health: `/api/v1/health`)
- API reference (Swagger UI): http://localhost:4000/api/v1/docs; OpenAPI JSON at `/api/v1/openapi.json`
- RAG service: http://127.0.0.1:8001/health (started by `npm run dev` once `npm run rag:setup` has been run; never exposed beyond this machine)

## Documents and the AI assistant

Upload policies, contracts, SOPs and rate sheets (PDF, Word, text, Markdown or CSV) under **Documents**. The RAG service parses them, splits them into passages and indexes them for hybrid search (vectors plus MySQL full-text). **AI Assistant** then answers questions from those passages and from your own figures, with numbered sources you can open.

- **Who sees what:** each document has a classification (General, Operations, Finance, HR, Management). People see only the classifications their role allows, and the assistant searches exactly that set, scoped to their organisation. Figures are looked up through the normal report endpoints with the asker's own token, so the usual permissions apply.
- **Mock mode (default):** without an Anthropic API key, answers quote the best-matching passages and list the figures as they are, and say clearly that no language model was used.
- **Claude:** set `ANTHROPIC_API_KEY` (and keep `LLM_PROVIDER=auto`, or set it to `claude`) and restart. Answers are then written by `ANTHROPIC_MODEL` (default `claude-opus-5-5`) from the same passages and figures only. Citations are checked against what was retrieved, and numbers that appear in no source are flagged.
- **Safety:** document text is treated as data, never as instructions; the Sahyadri demo company has a deliberate prompt-injection note that Kaveri users can never retrieve. Every question is recorded in `ai_queries`.

Details: [docs/rag.md](docs/rag.md).

## Share a public link

To let someone on another network try the app, run:

```powershell
npm run share
```

This builds the web app, starts the API and a preview server, and opens a free Cloudflare quick tunnel. It prints an `https://<random>.trycloudflare.com` link and also writes it to `storage/share/url.txt`.

- Stop `npm run dev` first. Share mode uses the same API port (4000).
- The link works only while the command runs, and each run gets a new link.
- If the PC is offline long enough for Cloudflare to drop the tunnel, the script opens a new one and prints the new link (and updates `url.txt`). Read the file again rather than reusing an old link.
- The tunnel needs outgoing port 7844. Some networks, such as campus Wi-Fi, block it; the script then says so and the link comes back on a network that allows it (home Wi-Fi or a phone hotspot).
- `npm run share -- --watch` keeps the same link while you edit code: the API reloads and the web app rebuilds on save.
- Anyone with the link can sign in with the demo accounts below, so share it only with people who should see the demo data.
- It needs `cloudflared`. Install it with `winget install --id Cloudflare.cloudflared`, or put `cloudflared.exe` in `%LOCALAPPDATA%\TransAxis\bin`.
- To publish code changes without changing the link, run `npm run build -w @transaxis/web` in another terminal. The preview server picks up the new build.

Share mode configures the API itself: `WEB_ORIGIN` becomes the tunnel URL (refresh and logout accept only listed origins), and `TRUST_PROXY=loopback` makes rate limits and session records see each visitor's real IP.

## Demo accounts

All demo accounts use the password **`Demo@12345`**. They exist only in seeded demo data; the seed refuses to run when `NODE_ENV=production`. All companies, people and registration numbers are fictional.

| Email | Role | Organisation |
|---|---|---|
| `admin@transaxis.demo` | Super Admin | TransAxis Platform |
| `owner@kaveri.demo` | Company Owner / Director | Kaveri Roadlines (Chennai) |
| `dispatch@kaveri.demo` | Transport Manager / Dispatcher | Kaveri Roadlines |
| `finance@kaveri.demo` | Accountant / Finance Manager | Kaveri Roadlines |
| `maintenance@kaveri.demo` | Fleet Maintenance Manager | Kaveri Roadlines |
| `control@kaveri.demo` | Security / Control Room Operator | Kaveri Roadlines |
| `hr@kaveri.demo` | HR / Driver Manager | Kaveri Roadlines |
| `driver@kaveri.demo` | Driver / Field Worker | Kaveri Roadlines |
| `customer@kaveri.demo` | Customer / Client | Kaveri Roadlines |
| `owner@sahyadri.demo` | Company Owner | Sahyadri Freight Carriers (Pune), a second tenant used to demonstrate data isolation |
| `dispatch@sahyadri.demo` | Dispatcher | Sahyadri Freight Carriers |

Five failed sign-ins lock an account for 15 minutes. To clear lockouts and reset all demo data, run `npm run db:seed -- --reset`.

## Try it

1. Sign in as `maintenance@kaveri.demo` and open **Vehicles**.
2. Filter by **Compliance → Has expired document**, open a vehicle, and add or renew a document. You can attach a PDF or image scan.
3. Sign in as `dispatch@kaveri.demo`. You can view vehicles but not edit them; the API returns 403 for edits.
4. Sign in as `owner@sahyadri.demo`. You see only Sahyadri's 6 vehicles; Kaveri's vehicles return 404.
5. Sign in as `finance@kaveri.demo`. Under **Invoices & Collections → Ready to invoice**, invoice a customer's delivered bookings, then record the payment with TDS. **Finance → Overview → Trial balance** stays balanced.
6. As `finance@kaveri.demo`, approve or reject claims under **Expenses**, then settle a driver under **Settlements**: preview, draft, approve, pay, and print the pay statement.
7. Sign in as `maintenance@kaveri.demo`. Open a work order, add a part from stock and labour, start it (the vehicle goes off the road) and complete it.
8. Sign in as `customer@kaveri.demo` for the customer portal: track a shipment, view invoices, request a new shipment.
9. Sign in as `driver@kaveri.demo` on a phone-sized window: add an expense to a trip, and see **My pay**.
10. Sign in as `owner@kaveri.demo`, open **AI Assistant** and ask "What is the detention charge for Coromandel?" or "What's our profit?". Click a source number to open the cited passage.
11. Still as the owner, open **Audit & Settings**: add a person (they get a one-time temporary password), edit a role's permissions, change a rule under **Settings**, and see it all in the **Audit log**. Click your name for **My account** to turn on two-step verification with an authenticator app.
12. Press **Ctrl+K** anywhere and type a registration number, trip number or name.
13. Sign in as `maintenance@kaveri.demo`: **Vehicles → Export** downloads the fleet as CSV, and **Import** checks a CSV file row by row before adding anything.

The [demo walkthrough](docs/demo-walkthrough.md) covers all of this step by step.

## Quality checks

```powershell
npm run typecheck   # all workspaces
npm run lint
npm test            # unit + API integration tests (integration tests need DATABASE_URL_TEST)
npm run test:rag    # RAG service tests (pytest; no database needed)
npm run build
```

The API integration tests rebuild `transaxis_test` from migrations and the seed on every run. The reset script refuses to touch any database whose name doesn't end in `_test`.

## Security overview

Full details and a production checklist: [docs/security.md](docs/security.md).


- **Passwords:** hashed with Argon2id (OWASP parameters).
- **Lockout and rate limits:** an account locks after 5 failed sign-ins, and login, two-step and reset requests are rate-limited.
- **Two-step verification:** optional TOTP (authenticator apps); each code works once and secrets are encrypted at rest (AES-256-GCM).
- **Temporary passwords:** new logins and resets get a one-time password; the API refuses everything except changing it until the person chooses their own.
- **Administration guards:** nobody can grant or assign administration access they don't have, act on an account with more access, change their own roles, or leave the organisation without a user manager.
- **Sessions:**
  - Access tokens are short-lived (15 min) JWTs held in memory.
  - Refresh tokens are opaque values in an httpOnly, SameSite=Strict cookie, stored only as SHA-256 hashes.
  - Refresh tokens rotate on every use, and reusing an old one revokes the whole session family.
- **Permissions:** checked on every route on the server. Every query is scoped to the caller's organisation, and other organisations' rows return 404 (no ID probing).
- **Audit log:** append-only, enforced by database triggers that block UPDATE and DELETE; viewable under Audit & Settings.
- **Exports:** CSV cells that a spreadsheet would run as formulas are defused.
- **Uploads:** file type is detected from content (the filename is ignored), sizes are limited, and files are stored under server-generated names outside the web root. Downloads are permission-checked and audited.
- **HTTP hardening:** Helmet security headers, a CORS allowlist, request IDs, and errors that never include stack traces.
- **Secrets:** kept in `.env`, which is git-ignored, and never sent to the browser.
- **RAG service:** listens on 127.0.0.1 only and accepts only short-lived (2-minute) HS256 tokens signed by the API, which carry the organisation, permissions and readable classifications. Searches filter by those claims and re-check every passage in MySQL before using it.

## Design

UI tokens follow the Google Stitch "Mission Command Logistics" design system ([docs/design/stitch](docs/design/stitch)): a slate navigation chrome, 4 px radius, Plus Jakarta Sans for headings and Inter for data, and a strict status-colour taxonomy (emerald for OK, amber for caution, crimson for critical, violet reserved for AI).
