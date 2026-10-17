# Database

MySQL 8, InnoDB, utf8mb4. The schema is defined in `database/src/schema/*.ts` (Drizzle) and created by the SQL migrations in `database/migrations` (79 tables). Diagrams below show the main relationships per area; every business table also has an `org_id` foreign key to `organizations`, left out of the diagrams for readability.

## Conventions

- **Tenancy:** every business row carries `org_id`; every query filters by it. Unique keys are per organisation (`uq_vehicles_org_reg`, `uq_workers_org_code`, `uq_customers_org_code`, …).
- **Money:** `DECIMAL(14,2)` in rupees, computed with decimal arithmetic, never floats. Quantities such as weight and fuel have their own scales.
- **Time:** instants are stored in UTC (`DATETIME(3)`); calendar dates (`DATE`) are the organisation's local dates (`organizations.timezone`, Asia/Kolkata in the demo).
- **Numbering:** human-readable numbers such as `TRP-2026-000123` or `INV-2026-000045` come from `number_sequences`, per organisation, scope and year, assigned inside the same transaction as the row.
- **Append-only tables:** `audit_logs` and `journal_lines` have triggers that block UPDATE and DELETE. Ledger corrections are reversal entries.
- **Soft state, not deletes:** most master data is deactivated (`status`, `is_active`) rather than deleted, so history stays intact.

## Identity, access and platform

```mermaid
erDiagram
  organizations ||--o{ branches : has
  organizations ||--o{ users : employs
  organizations ||--o{ roles : defines
  organizations ||--o{ org_settings : configures
  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : "granted by"
  users ||--o{ user_roles : holds
  roles ||--o{ user_roles : "held by"
  users ||--o{ user_sessions : "signs in"
  users ||--o{ password_reset_tokens : requests
  users ||--o{ audit_logs : "acts in"
  users }o--o| workers : "driver login"
  users }o--o| customers : "portal login"
  organizations ||--o{ number_sequences : numbers
  organizations ||--o{ files : stores
```

| Table | Notes |
|---|---|
| `users` | Argon2id `password_hash`; lockout counters; `must_change_password` for temporary passwords; `totp_secret_enc` (AES-256-GCM), `totp_enabled`, `totp_last_step` (replay protection); optional `worker_id` / `customer_id` links |
| `user_sessions` | Refresh sessions: only the SHA-256 of the token, a `family_id` for reuse detection, rotation and revocation times |
| `roles`, `role_permissions`, `permissions` | Built-in roles per organisation (`is_system`) plus custom roles (`custom_*`); the permission catalogue is global |
| `org_settings` | JSON values for the allowed keys (document warning days, minimum rest, maximum duty) |
| `audit_logs` | Who, what, before/after JSON, IP, browser, request ID. Append-only |
| `job_locks` | Leases that keep each background job to one runner |

## Fleet, people and customers

```mermaid
erDiagram
  vehicle_types ||--o{ vehicles : classifies
  branches ||--o{ vehicles : bases
  vendors ||--o{ vehicles : "hired from"
  vehicles ||--o{ vehicle_documents : "RC, insurance, permits"
  branches ||--o{ workers : bases
  compensation_policies ||--o{ workers : "pays by"
  workers ||--o{ driver_licences : holds
  driver_licences ||--o{ driver_licence_classes : covers
  workers ||--o{ worker_documents : has
  workers ||--o{ worker_trainings : completes
  workers ||--o{ leave_requests : requests
  workers ||--o{ attendance : records
  workers ||--o{ duty_rosters : "is rostered"
  customers ||--o{ customer_contacts : has
  customers ||--o{ customer_rate_cards : "is quoted by"
  vehicle_types ||--o{ customer_rate_cards : "priced for"
  customers ||--o{ locations : "loads and unloads at"
```

## Bookings and trips

```mermaid
erDiagram
  customers ||--o{ bookings : places
  routes ||--o{ bookings : follows
  vehicle_types ||--o{ bookings : needs
  bookings ||--o{ booking_stops : "pickup and drop"
  locations ||--o{ booking_stops : at
  bookings ||--o{ booking_charges : "priced by"
  bookings ||--o{ cargo_items : carries
  bookings ||--o{ trips : "fulfilled by"
  vehicles ||--o{ trips : runs
  trips ||--o{ trip_crew : "driven by"
  workers ||--o{ trip_crew : drives
  trips ||--o{ trip_stops : visits
  booking_stops ||--o{ trip_stops : "planned as"
  trips ||--o{ trip_events : "milestones"
  trips ||--o{ trip_status_history : "state changes"
  trips ||--o{ inspections : "pre-trip checks"
  inspection_templates ||--o{ inspections : uses
  trips ||--o{ cargo_seals : seals
  trips ||--o| proof_of_delivery : "delivered with"
  trips ||--o{ resource_reservations : "holds vehicle and crew"
```

`resource_reservations` stops a vehicle or person being booked on two overlapping trips; the eligibility rules in `packages/shared/src/rules/eligibility.ts` also check licences, documents, rest and duty hours.

## Live operations

```mermaid
erDiagram
  vehicles ||--o{ gps_events : reports
  trips ||--o{ gps_events : "tracked by"
  vehicles ||--|| vehicle_last_positions : "latest fix"
  trips ||--o{ safety_alerts : raises
  trips ||--o{ incidents : "may have"
  incidents ||--o{ incident_updates : "history"
  trips ||--o{ driver_checkins : "checked in"
  locations ||--o{ geofences : "fenced as"
  users ||--o{ notifications : receives
```

## Finance

```mermaid
erDiagram
  ledger_accounts ||--o{ journal_lines : "debited or credited"
  journal_entries ||--|{ journal_lines : "balanced lines"
  customers ||--o{ invoices : billed
  invoices ||--|{ invoice_lines : lists
  bookings ||--o{ invoice_lines : "billed on"
  invoices ||--o{ credit_notes : "corrected by"
  customers ||--o{ receipts : pays
  receipts ||--o{ receipt_allocations : "applied to"
  invoices ||--o{ receipt_allocations : "settled by"
  expense_categories ||--o{ expenses : groups
  trips ||--o{ expenses : "incurred on"
  vehicles ||--o{ fuel_logs : fuels
  workers ||--o{ driver_earnings : earns
  trips ||--o{ driver_earnings : "earned on"
  workers ||--o{ driver_advances : "is advanced"
  workers ||--o{ driver_deductions : "has deducted"
  workers ||--o{ settlements : "is settled"
  settlements ||--o{ advance_recoveries : recovers
  driver_advances ||--o{ advance_recoveries : "recovered by"
```

Every financial document (invoice, receipt, approved expense, fuel log, work order, earning, advance, settlement) points to the `journal_entries` row it posted. The ledger service refuses an entry whose debits and credits differ, and `journal_entries.idempotency_key` (unique per organisation, such as `fuel:812`) makes posting the same document twice impossible.

## Maintenance

```mermaid
erDiagram
  vehicles ||--o{ work_orders : "repaired by"
  vendors ||--o{ work_orders : "outside workshop"
  maintenance_schedules ||--o{ work_orders : "raised from"
  vehicles ||--o{ maintenance_schedules : "serviced by"
  work_orders ||--o{ work_order_items : "parts and labour"
  spare_parts ||--o{ work_order_items : "used in"
  spare_parts ||--o{ inventory_movements : "stock in and out"
  vehicles ||--o{ tyres : "fitted with"
```

## Documents and the assistant

```mermaid
erDiagram
  documents ||--o{ document_chunks : "split into"
  documents ||--o| documents : "replaces (versions)"
  users ||--o{ documents : uploads
  users ||--o{ ai_queries : asks
```

`document_chunks.content` has a FULLTEXT index for keyword search; vectors live in Qdrant (`storage/qdrant`), keyed by chunk ID and filtered by organisation and classification.

## Migrations

| File | Adds |
|---|---|
| `0000_init_core_fleet` | Organisations, users, roles, permissions, sessions, settings, files, fleet |
| `0001_audit_append_only` | Triggers that make `audit_logs` append-only |
| `0002_operations` | People, customers, vendors, bookings, trips |
| `0003_live_ops` | GPS, alerts, incidents, check-ins, notifications |
| `0004_finance_maintenance` | Ledger, invoices, receipts, expenses, fuel, crew pay, maintenance |
| `0005_journal_append_only` | Triggers that make `journal_lines` append-only |
| `0006_documents_ai`, `0007_documents_fulltext` | Documents, passages, AI queries, FULLTEXT index |
| `0008_user_totp_step` | `users.totp_last_step` for two-step replay protection |

Apply with `npm run db:migrate`. Migrations are plain SQL, reviewed before commit; never edit one that has been applied, add a new one.
