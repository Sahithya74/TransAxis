# Security

How TransAxis protects accounts, tenant data and money records, what is tested, and what a production deployment still needs. The controls are listed with the code that implements them so they can be checked.

## Threats this design addresses

| Threat | Control |
|---|---|
| Password guessing | Argon2id hashes; 5 failures lock the account for 15 minutes; per-IP and per-email rate limits on sign-in, two-step codes and reset requests; the same message for a wrong password and an unknown email |
| Stolen password | Optional two-step verification (TOTP authenticator apps) |
| Stolen session | 15-minute access tokens in memory only; refresh token in an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`; rotation on every refresh; reuse of an old refresh token revokes the whole session family |
| One company seeing another's data | Every query filters by the caller's organisation; other organisations' rows return 404; integration tests try cross-tenant reads and writes |
| Staff seeing more than their role allows | Permission check on every route (`requirePermission`), plus row-level scoping for drivers (own trips and pay) and portal customers (own bookings and invoices) |
| An administrator raising their own access | Administration permissions can only be granted, removed or assigned by someone who holds them; nobody can change their own roles or disable themselves; nobody can reset the password or two-step of an account with more administration access |
| Locking everyone out | A change that would leave no active user able to manage users is refused |
| Tampering with history | `audit_logs` and `journal_lines` are append-only, enforced by database triggers; ledger corrections are reversal entries |
| Malicious uploads | File type detected from content (not the name or browser-sent type), size limits, server-generated storage names outside the web root, permission-checked and audited downloads with `nosniff` |
| Spreadsheet formula injection | CSV exports prefix text starting with `=`, `+`, `-` or `@` with an apostrophe (negative numbers are left alone) |
| Prompt injection through documents | Document text is wrapped as untrusted data for the language model; passages are re-checked in MySQL for organisation and classification before use; the seeded Sahyadri note contains a deliberate injection attempt that Kaveri users can never retrieve |
| Leaking internals | Errors never include stack traces; logs redact authorisation headers, cookies and passwords; every response carries a request ID that appears in the logs and the audit trail |

## Accounts and sign-in

- **Passwords** (`database/src/password.ts`): Argon2id with OWASP-recommended parameters. Policy: at least 10 characters with upper and lower case letters and a number.
- **Temporary passwords** (Administration → People): 14 random characters from an alphabet without look-alike characters, shown once to the administrator and stored only as a hash. Until the person chooses their own, their access token carries a `pwd` claim and the API refuses every endpoint except the account ones with `403 PASSWORD_CHANGE_REQUIRED`.
- **Two-step verification** (`apps/api/src/lib/totp.ts`):
  - RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits), checked against the published RFC test vectors.
  - Accepts one step of clock drift either way.
  - Each code works once: the last accepted step is stored and updated with a conditional `UPDATE … WHERE totp_last_step < ?`, so two requests racing with the same code can't both succeed (tested).
  - Secrets are encrypted at rest with AES-256-GCM; the key is derived with HKDF from `TOTP_ENCRYPTION_KEY` (or `JWT_ACCESS_SECRET` when unset).
  - After the password, sign-in returns only a 5-minute challenge token with its own audience; the session is issued after the code. Wrong codes count toward the same lockout.
  - Turning it off needs the password. An administrator can reset it for a lost phone (not for their own account, and not for someone with more administration access).
- **Password reset links** are single-use, expire, and are stored as hashes. The request endpoint answers the same way whether or not the account exists.

## Authorisation

- The permission catalogue (`packages/shared/src/permissions.ts`) is the single source of truth. Default roles are in `roles.ts`; each organisation's copy can be changed in the roles editor.
- Permissions travel in the access token, so changes reach people within 15 minutes. Changing a person's roles or disabling them revokes their refresh sessions straight away.
- Suspending an organisation (platform administrators only) revokes all its sessions, and the API refuses its access tokens immediately through a cached organisation check, not just when they expire.
- The web app hides what a role can't use, but this is a convenience only: the API enforces the same rules and the tests call the API directly.

## Data protection

- Sensitive worker data (date of birth, address, blood group, emergency contacts, pay) is returned, exported, imported and editable only with `workers:sensitive`. Licence numbers are masked without it.
- Document classifications (General, Operations, Finance, HR, Management) each require permissions; search and the assistant only ever see the classifications the asker can read.
- Customer-portal users are linked to one customer and see only that customer's records, enforced in the services.
- The audit log records who changed what, with before/after values, IP address, browser and request ID. Secrets are never written to it (worker sensitive fields are redacted in audit entries).

## Service-to-service

- The RAG service binds to 127.0.0.1 only. The API calls it with 2-minute HS256 tokens (issuer `transaxis-api`, audience `transaxis-rag`) carrying the organisation, permissions and readable classifications; the service re-checks every passage in MySQL before using it.
- For figures, the RAG service calls the API's report endpoints with the asker's own access token, so the normal permission checks apply.

## HTTP

- Helmet security headers; CORS allowlist (`WEB_ORIGIN` plus `EXTRA_WEB_ORIGINS`) with credentials; refresh and logout also check the `Origin` header.
- JSON bodies are limited to 1 MB; uploads to `MAX_UPLOAD_MB` / `MAX_DOCUMENT_MB`.
- `trust proxy` is off by default and set to one hop in production, so rate limits see real client IPs only behind a known proxy.

## What is tested

- Auth: lockout, uniform errors, refresh rotation and reuse detection, cookie flags, hashed storage (`apps/api/test/auth.int.test.ts`).
- Two-step: RFC 4226/6238 vectors, drift window, encryption and tampering (`apps/api/src/lib/totp.test.ts`); setup, sign-in, replay, the race, disable and admin reset (`apps/api/test/admin.int.test.ts`).
- Administration guards: no self-demotion, lockout prevention, no granting or assigning administration access you lack, no takeover of a higher account, tenant suspension (`admin.int.test.ts`).
- Tenant isolation and role scoping across every module's integration tests; document classification and prompt-injection isolation (`documents.int.test.ts`, `services/rag/tests`).
- CSV: formula defusing, parsing edge cases, sensitive-column handling on import and export (`csv.test.ts`, `exchange.int.test.ts`).

## Before running this in production

This is a demo deployment. Before real use:

1. **Secrets:** generate fresh `JWT_ACCESS_SECRET`, `RAG_SERVICE_SECRET` and `TOTP_ENCRYPTION_KEY` (48 random bytes each) and keep them in a secret store, not in a file on the server. Rotating `TOTP_ENCRYPTION_KEY` means everyone re-enrols two-step sign-in.
2. **TLS:** serve the web app and API over HTTPS only, behind one reverse proxy; set `TRUST_PROXY=1` and `NODE_ENV=production` (which also turns on the `Secure` cookie flag).
3. **Demo data:** never run the seed. It refuses `NODE_ENV=production`, but use a clean database anyway, and create the first administrator by hand.
4. **Database:** use a least-privilege application user (the bootstrap script creates one), encrypted backups, and the `operations.md` restore drill.
5. **Email:** configure SMTP so password reset links reach people; the default provider only writes them to the log.
6. **Two-step:** consider requiring it for owners and administrators.
7. **Public tunnel:** `npm run share` is for demos only. Anyone with the link can reach the sign-in page.
8. **Dependencies:** run `npm audit` and `pip-audit` regularly and before each release.
