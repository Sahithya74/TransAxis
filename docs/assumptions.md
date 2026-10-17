# Assumptions and limits

Decisions taken where the brief left room, and what the system deliberately does not do. Each is a starting point that can change.

## Business

- **Market:** Indian road freight. Money is in rupees, amounts are shown in the Indian grouping (₹12,34,567), dates in the organisation's timezone (Asia/Kolkata for the demo companies), and the financial year runs April to March (Q1 is April–June).
- **GST:** transport services are treated as a goods transport agency (SAC 9965): reverse charge at 5% by default, or forward charge at 12% or 5%; CGST/SGST within a state, IGST between states. E-invoicing (IRN) and e-way bills are not connected.
- **TDS:** customers may deduct TDS when paying; receipts record it as a receivable from the tax department, not as a discount.
- **Crew pay:** earned per trip when a trip completes, under the worker's compensation policy; advances and deductions are recovered in settlements. Payroll statutory deductions (PF, ESI, professional tax) are not calculated.
- **Rest and duty rules:** the defaults (8 hours minimum rest, 12 hours maximum duty per trip, documents warned 15 days ahead) are organisation settings, not legal advice; companies should set them to their own policy and the Motor Transport Workers Act.
- **One vehicle, one trip at a time:** resource reservations prevent overlapping trips for a vehicle or a crew member. Multi-drop trips are stops on one trip.

## Product

- **Tenancy:** one database for all companies, separated by `org_id` on every row and checked on every query. The platform company (TransAxis Platform) hosts the super administrator, who manages tenants but works inside their own company for everything else.
- **Roles:** nine built-in roles per company plus custom roles. The owner role has read access across the business plus administration, not every operational write permission; owners hand operational work to the roles that do it.
- **Administration levels:** anyone who manages users can grant operational permissions, but administration permissions only by someone who holds them. This keeps an owner in control even after delegating user management.
- **Imports create, never update:** CSV imports add new records and leave existing ones (matched by registration number, employee code or customer code) unchanged, so a re-imported export is harmless. Updates go through the forms, where each change is audited field by field.
- **Search** covers vehicles, people, customers, bookings, trips, invoices and documents (titles and file names). Document contents are searched by the AI assistant, not the Ctrl+K box.

## Simulated or not connected

- **GPS:** positions come from a built-in simulator that follows planned routes, labelled SIMULATED everywhere they appear. Drivers can share real phone location. Telematics devices and a routing or traffic provider are future integrations.
- **Messaging:** in-app notifications are real; email goes through SMTP when configured; otherwise messages, including password reset links and delivery codes, are written to the API log. SMS and WhatsApp are not connected.
- **Fuel cards, FASTag, payment gateways:** not connected; their data is entered by hand.
- **AI:** without `ANTHROPIC_API_KEY` the assistant runs in a labelled mock mode that quotes the retrieved passages and figures. With a key, answers are written by Claude from those sources only. Default embeddings are a deterministic word-overlap method; semantic embeddings are an option (`npm run rag:setup -- --semantic`).
- **Scanned PDFs** without a text layer are rejected with a clear message; there is no OCR.

## Technical

- **Deployment:** designed for one API process with background jobs inside it; job leases (`job_locks`) make a second process safe but no load balancer or queue is included.
- **Sessions:** permissions are carried in 15-minute access tokens, so a role change can take up to 15 minutes to reach someone already signed in (disabling or changing their roles revokes refresh sessions at once, and suspending a company takes effect immediately).
- **Browsers:** current Chrome, Edge, Firefox and Safari. The driver app and portal are designed for phones; the back office for screens at least 1024 px wide, usable on tablets.
- **Public demo link:** a Cloudflare quick tunnel, which needs outgoing port 7844 and gets a new address on every run. It is for demonstrations, not production hosting.
