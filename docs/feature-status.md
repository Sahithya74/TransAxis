# Feature status

Status values:

- **Implemented:** built, tested and running against the real database.
- **Simulated:** works, but uses generated or demo data in place of a real-world integration, and is labelled as such in the UI.
- **Planned:** designed in the implementation plan, not built yet.
- **Future integration:** needs an external provider that isn't connected.

_Last updated: Phase 1._

## Platform and security

| Feature | Status | Notes |
|---|---|---|
| Multi-tenant organisations, branches | Implemented | Every query is scoped by organisation; other tenants' rows return 404 |
| Sign-in, refresh rotation, reuse detection, logout | Implemented | Integration-tested |
| Account lockout, login and reset rate limits | Implemented | 5 failures → 15-minute lock |
| Password reset and change | Implemented | Reset links go through a log-only messaging provider until SMTP is configured |
| Role-based permissions (9 roles, 50 permissions) | Implemented | Enforced server-side; navigation is filtered on the client |
| Append-only audit log | Implemented | Database triggers block UPDATE and DELETE |
| Secure file upload and download | Implemented | Content-type detection, size limits, permission-checked and audited downloads |
| OpenAPI reference and Swagger UI | Implemented | Generated from the validation schemas |
| Roles editor, user admin UI, tenant admin UI | Planned | Phase 6 |
| TOTP two-factor sign-in | Planned | Phase 6 (columns already exist) |

## Fleet

| Feature | Status | Notes |
|---|---|---|
| Vehicle registry: list, search, filters, sort, pagination | Implemented | |
| Vehicle create and edit with validation | Implemented | Registration normalised and unique per organisation; odometer cannot decrease |
| Manual status changes | Implemented | `assigned`/`on_trip` belong to the trip lifecycle and can't be overridden |
| Compliance documents (RC, insurance, fitness, permit, PUC, road tax) | Implemented | Expiry state uses the organisation's local date and a configurable warning window |
| Fleet status and compliance dashboard | Implemented | |
| Vehicle types | Implemented (API) | Management UI planned |
| Maintenance, fuel, tyres, spare parts | Planned | Phase 4 |

## Operations, tracking, safety, finance, AI

| Area | Status | Phase |
|---|---|---|
| Drivers and workforce, customers, vendors, rate cards | Planned | 2 |
| Bookings, assignment eligibility, trip lifecycle, POD/OTP, lorry receipt | Planned | 2 |
| Dispatch board, live map, ETA | Planned | 3. GPS will be **simulated** and labelled; real telematics is a future integration |
| Safety alerts, incidents, check-ins, SOS | Planned | 3. Demo SOS is simulated; no emergency services are contacted |
| Notifications, calendar | Planned | 3. Email via SMTP if configured; SMS is a future integration |
| Driver mobile app, customer portal | Planned | 3 and 4 |
| Invoices (GST), receipts, expenses, advances, settlements, ledger | Planned | 4 |
| Reports and analytics | Planned | 4 |
| Document ingestion, hybrid search, AI assistant with citations | Planned | 5. Claude when an API key is set, otherwise a clearly labelled mock mode |

## Future integrations (not planned to be built against real providers in this project)

- GPS and telematics devices, plus a routing and traffic provider for ETA
- SMS and WhatsApp notifications
- NIC e-way bill API, FASTag toll reconciliation, fuel-card statements
- Payment gateways
