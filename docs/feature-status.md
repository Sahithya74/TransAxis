# Feature status

Status values:

- **Implemented:** built, tested and running against the real database.
- **Simulated:** works, but uses generated or demo data in place of a real-world integration, and is labelled as such in the UI.
- **Experimental:** works on real records but is a simple rule set, not a prediction, and is labelled Experimental in the UI.
- **Planned:** designed in the implementation plan, not built yet.
- **Future integration:** needs an external provider that isn't connected.

_Last updated: Phase 6 complete (administration, two-step sign-in, search, CSV import/export, documentation)._

## Platform and security

| Feature | Status | Notes |
|---|---|---|
| Multi-tenant organisations, branches | Implemented | Every query is scoped by organisation; other tenants' rows return 404 |
| Sign-in, refresh rotation, reuse detection, logout | Implemented | Integration-tested |
| Account lockout, login and reset rate limits | Implemented | 5 failures → 15-minute lock |
| Password reset and change | Implemented | Reset links go through a log-only messaging provider until SMTP is configured |
| Role-based permissions (9 built-in roles plus custom roles, 50 permissions) | Implemented | Enforced server-side; navigation is filtered on the client |
| Append-only audit log | Implemented | Database triggers block UPDATE and DELETE |
| Secure file upload and download | Implemented | Content-type detection, size limits, permission-checked and audited downloads |
| OpenAPI reference and Swagger UI | Implemented | Generated from the validation schemas |
| Public demo link (`npm run share`) | Implemented | Cloudflare quick tunnel over HTTP/2. The URL is temporary: it changes on every run, and again if the tunnel is lost, which the script detects and replaces by itself. Networks that block port 7844 (some campus Wi-Fi) can't carry it |
| People administration: create with a one-time temporary password, roles, driver and customer links, disable, reset password, unlock, reset two-step | Implemented | Phase 6. Temporary passwords must be changed before anything else works (enforced by the API) |
| Roles editor with custom roles | Implemented | Phase 6. Administration permissions can only be granted by holders; no self-demotion, no lockout, no acting on a higher account |
| Organisation settings (profile, timezone, document warning window, rest and duty limits) and expense-category configuration | Implemented | Phase 6 |
| Audit log viewer with filters and before/after values | Implemented | Phase 6 |
| System health (database, document service, storage, background jobs) | Implemented | Phase 6 |
| Tenant administration: suspend and reactivate companies | Implemented | Phase 6. Platform administrators only; suspension takes effect immediately |
| Two-step sign-in (TOTP authenticator apps) | Implemented | Phase 6. RFC 6238, one-time use, encrypted secrets, admin reset for lost phones |
| Global search (Ctrl+K) | Implemented | Phase 6. Vehicles, people, customers, bookings, trips, invoices and documents, filtered by permission |
| CSV export and checked import for vehicles, workers and customers | Implemented | Phase 6. Imports add new records only; nothing is written while any row has an error |

## Fleet

| Feature | Status | Notes |
|---|---|---|
| Vehicle registry: list, search, filters, sort, pagination | Implemented | |
| Vehicle create and edit with validation | Implemented | Registration normalised and unique per organisation; odometer cannot decrease |
| Manual status changes | Implemented | `assigned`/`on_trip` belong to the trip lifecycle and can't be overridden |
| Compliance documents (RC, insurance, fitness, permit, PUC, road tax) | Implemented | Expiry state uses the organisation's local date and a configurable warning window |
| Fleet status and compliance dashboard | Implemented | |
| Vehicle types | Implemented (API) | Management UI planned |
| Work orders: parts from stock, labour, start/complete/cancel, vehicle off the road while in the workshop, cost posted to the ledger | Implemented | Phase 4 |
| Service schedules due by distance or time, whichever comes first | Implemented | Phase 4 |
| Spare parts with weighted-average stock cost, purchases and reorder levels; tyres fitted, removed and worn | Implemented | Phase 4 |
| Fuel log with full-tank-to-full-tank mileage and flags for low mileage, overfills and odometer errors | Implemented | Phase 4. Fuel-card statements are a future integration |
| Maintenance hints (repeated breakdowns, falling fuel economy, overdue services) | Experimental | Phase 4. Rules over your own records, not a trained model |

## Operations, tracking, safety, finance, AI

| Area | Status | Phase |
|---|---|---|
| Drivers and workforce (licences, training, leave, attendance), customers, vendors, contacts, rate cards | Implemented | 2 |
| Bookings (form, quote from rate card, approval, hold/cancel), assignment drawer with eligibility checks and overrides | Implemented | 2 |
| Trip lifecycle: inspections and seals, dispatch with delivery OTP, POD by OTP or authorised override with photos, milestones, completion, reconciliation | Implemented | 2 |
| Dispatch board, week calendar, return-load (backhaul) suggestions | Implemented | 2 |
| Printable lorry receipt and trip sheet | Implemented | 2 |
| Live fleet map with planned route, actual trail and push updates (Socket.IO) | Simulated | 3. Positions come from the built-in simulator and are labelled SIMULATED; drivers can also share real phone GPS. Telematics devices are a future integration |
| ETA (route history, then standard speed, then schedule) with stated method and confidence | Implemented | 3. A routing/traffic provider is a future integration |
| Safety alerts: no signal, unplanned stop, route deviation, overspeed, restricted zones, running late, missed check-in, SOS | Implemented | 3. De-duplicated; warnings clear themselves, critical alerts wait for a person |
| Incidents with numbering, workflow, assignment, escalation and history; driver check-ins; SOS | Implemented | 3. SOS alerts the control room only; no emergency services are contacted |
| In-app notifications with escalation of unacknowledged critical items | Implemented | 3. Email via SMTP when configured; SMS/WhatsApp are future integrations |
| Driver app (mobile web): trips, inspections, start, milestones, check-in, OTP delivery, location sharing, SOS | Implemented | 3 |
| Customer portal: shipments with live tracking and proof of delivery, invoices, shipment requests | Implemented | 4. Customers see only their own records, enforced on the server |
| GST tax invoices for a goods transport agency (SAC 9965: reverse charge 5%, forward charge 12% or 5%; CGST/SGST or IGST by state), credit notes, cancellation | Implemented | 4. E-invoicing (IRN) is a future integration |
| Receipts with TDS, applied oldest-first or to chosen invoices; receivables ageing | Implemented | 4 |
| Expense claims with receipt rules and approval; crew pay accrued on trip completion; advances, deductions and settlements with pay statements | Implemented | 4 |
| Double-entry ledger with idempotent postings, reversal-only corrections (database-enforced) and a trial balance | Implemented | 4 |
| Finance overview, trip profitability (with provisional flags), 7 management reports with CSV export, role dashboards | Implemented | 4 |
| Document library: upload (PDF, Word, text, Markdown, CSV) with content checks, classifications, versions, reprocess, delete, passage viewer | Implemented | 5. Scanned PDFs without a text layer are rejected with a clear message (no OCR) |
| Hybrid search: vector (embedded Qdrant) plus MySQL full-text, fused by reciprocal rank, filtered by organisation and classification | Implemented | 5. Default embeddings are deterministic feature hashing (word overlap); local semantic embeddings are optional (`npm run rag:setup -- --semantic`, `EMBEDDING_PROVIDER=fastembed`) |
| AI assistant: routes questions to documents, figures or both; asks which period when needed; follow-ups keep context; citations and figure cards with links | Implemented | 5. Without `ANTHROPIC_API_KEY` it runs in a labelled mock mode that quotes passages and figures without a language model |
| Answers written by Claude from the retrieved passages and figures only, with citation and number checks | Implemented, needs a key | 5. Not exercised in this environment because no API key is configured |

## Future integrations (not planned to be built against real providers in this project)

- GPS and telematics devices, plus a routing and traffic provider for ETA
- SMS and WhatsApp notifications
- NIC e-way bill API, FASTag toll reconciliation, fuel-card statements
- Payment gateways and GST e-invoicing (IRN)
