# TransAxis

Fleet management and transport-operations platform for Indian road-freight companies: vehicles, drivers, bookings, dispatch, trip tracking, cargo security, maintenance, finance and settlements, analytics, and a document-grounded AI assistant.

> **Build status:** Phase 1 (foundation and first vertical slice) is complete. The other modules are being built in phases; see [docs/feature-status.md](docs/feature-status.md) for exactly what works today, what is simulated, and what is planned. Navigation items that aren't built yet are shown greyed out with a "Soon" tag.

## Stack

| Layer | Technology |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router |
| API | Node.js, Express 5, TypeScript, zod validation, JWT access tokens + rotating refresh cookies |
| Database | MySQL 8 via Drizzle ORM; SQL migrations in `database/migrations` |
| Shared | `packages/shared`: permissions, roles, enums, validation schemas, pure business rules (used by API and web) |
| AI / RAG (planned) | Python FastAPI service, Qdrant, MySQL FULLTEXT, Claude or a labelled mock mode |

```
apps/web          React front end
apps/api          Express REST API (/api/v1)
packages/shared   Shared schemas, permissions and business rules
database          Drizzle schema, SQL migrations, deterministic seed
docs              Architecture, feature status, design references
scripts           Dev launcher and local MySQL helper
```

## Prerequisites

- Node.js 20.19+ (developed on 24) and npm 10+
- MySQL 8.0+. Either an existing server, or the installed MySQL binaries run as a private dev instance (below).
- Windows PowerShell for the `mysql:*` helper scripts

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
```

## Run

```powershell
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000/api/v1 (health: `/api/v1/health`)
- API reference (Swagger UI): http://localhost:4000/api/v1/docs; OpenAPI JSON at `/api/v1/openapi.json`

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

## Quality checks

```powershell
npm run typecheck   # all workspaces
npm run lint
npm test            # unit + API integration tests (integration tests need DATABASE_URL_TEST)
npm run build
```

The API integration tests rebuild `transaxis_test` from migrations and the seed on every run. The reset script refuses to touch any database whose name doesn't end in `_test`.

## Security overview

- **Passwords:** hashed with Argon2id (OWASP parameters).
- **Lockout and rate limits:** an account locks after 5 failed sign-ins, and login and reset requests are rate-limited per IP and email.
- **Sessions:**
  - Access tokens are short-lived (15 min) JWTs held in memory.
  - Refresh tokens are opaque values in an httpOnly, SameSite=Strict cookie, stored only as SHA-256 hashes.
  - Refresh tokens rotate on every use, and reusing an old one revokes the whole session family.
- **Permissions:** checked on every route on the server. Every query is scoped to the caller's organisation, and other organisations' rows return 404 (no ID probing).
- **Audit log:** append-only, enforced by database triggers that block UPDATE and DELETE.
- **Uploads:** file type is detected from content (the filename is ignored), sizes are limited, and files are stored under server-generated names outside the web root. Downloads are permission-checked and audited.
- **HTTP hardening:** Helmet security headers, a CORS allowlist, request IDs, and errors that never include stack traces.
- **Secrets:** kept in `.env`, which is git-ignored, and never sent to the browser.

## Design

UI tokens follow the Google Stitch "Mission Command Logistics" design system ([docs/design/stitch](docs/design/stitch)): a slate navigation chrome, 4 px radius, Plus Jakarta Sans for headings and Inter for data, and a strict status-colour taxonomy (emerald for OK, amber for caution, crimson for critical, violet reserved for AI).
