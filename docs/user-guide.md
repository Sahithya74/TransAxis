# User guide

TransAxis shows each person only the parts of the system their role uses. This guide is organised by role; the [demo walkthrough](demo-walkthrough.md) is a scripted tour using the demo accounts.

## Everyone

- **Signing in:** your email and password. If two-step verification is on, enter the 6-digit code from your authenticator app next. Five wrong attempts lock the account for 15 minutes; an administrator can unlock it sooner.
- **First sign-in:** if an administrator gave you a temporary password, you'll be asked to choose your own straight away. Enter the temporary one as the current password.
- **My account** (click your name at the top right): change your password, which signs you out on other devices, and turn two-step verification on or off.
  - To turn it on, choose **Set up**, scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy and others), and enter the code it shows.
  - If you lose your phone, ask an administrator to reset two-step verification for you.
- **Search** (Ctrl+K, ⌘K or /): jump to any page, or find a vehicle by registration number (spaces don't matter), a trip, booking or invoice by number, a person, a customer, or a document. Results only include what your role can open.
- **Notifications** (the bell): alerts and approvals waiting for you. Critical items escalate if nobody acknowledges them.
- **Times and dates** are shown in your organisation's timezone, whatever your computer's timezone is.

## Owner or director

- **Dashboard:** today's trips, fleet availability, compliance warnings, money owed and the week's highlights.
- **Finance → Overview** and **Reports:** revenue, costs, trip profit, receivables ageing and seven management reports with CSV export.
- **AI Assistant:** ask about policies and contracts ("What is the detention charge for Coromandel?") or figures ("What was our profit last quarter?"). Every answer lists its sources; click a number to open the passage.
- **Audit & Settings:** see [Administrators](#administrators) below.

## Dispatcher

1. **Bookings → New booking:** customer, route and stops, cargo, vehicle type. The quote comes from the customer's rate card and can be adjusted. A booking goes from draft to quoted to approved; approving needs the `bookings:approve` permission.
2. **Dispatch Board:** a column of approved bookings still **To plan**, then a column per trip stage. Plan a trip from a booking and pick the vehicle and crew: the assignment drawer explains every warning (expiring documents, licence class, rest or duty hours) and blocks what isn't allowed; some warnings can be overridden with a written reason.
3. **Trips:** inspections and seals, dispatch (the customer receives a delivery code), milestones, proof of delivery by code or an authorised override with photos, and completion.
4. **Calendar:** the week's trips by vehicle; return-load suggestions help avoid empty return journeys.
5. **Live Fleet Map:** where each vehicle is, its planned route and trail, and its ETA with the method used. In the demo, positions are simulated and labelled SIMULATED.

## Control room

- **Control Room:** live alerts by severity (no signal, unplanned stop, route deviation, overspeed, restricted zone, running late, missed check-in, SOS). Acknowledge, then resolve with a note; warnings clear themselves when the cause goes away, critical alerts wait for a person.
- **Incidents:** raise or take over an incident, assign it, record updates and close it. SOS raises a critical incident for the control room; it doesn't contact emergency services.

## Accountant

- **Invoices & Collections → Ready to invoice:** delivered bookings grouped by customer. Create a GST invoice (reverse or forward charge, CGST/SGST or IGST decided by state), print it, and record payments with TDS, applied oldest-first or to chosen invoices. Corrections are credit notes.
- **Expenses:** approve or reject claims; approved claims post to the ledger. Categories and receipt rules are set by administrators under **Configuration**.
- **Settlements:** preview a driver's earnings, advances and deductions for a period, then draft, approve and pay; print the pay statement.
- **Finance → Overview → Trial balance:** always balances; the ledger can't be edited, only reversed.

## Fleet maintenance manager

- **Vehicles:** registration, documents (RC, insurance, fitness, permit, PUC, road tax) with expiry warnings, status. **Export** downloads the fleet as CSV; **Import** adds vehicles from a CSV file (see [Importing](#importing-from-a-spreadsheet)).
- **Maintenance:** work orders (parts from stock and labour; the vehicle is off the road while in the workshop), service schedules due by distance or time, spare-part stock and tyres.
- **Fuel:** fill-ups with mileage from full tank to full tank, and flags for low mileage, overfills and odometer errors.

## HR or driver manager

- **Drivers & Workforce:** people, licences (with verification), training, documents, leave and attendance. Pay and personal details are visible only to HR roles. **Export** and **Import** work as for vehicles; pay and personal columns are included only for HR roles.
- **Settlements:** crew pay, as for accountants.

## Driver (phone)

Sign in on a phone browser. **My trips** shows today's work: run the inspection, start the trip, record milestones, check in when asked, add expenses with photos of receipts, and complete the delivery with the customer's code. **SOS** alerts the control room. **My pay** shows earnings and settlements.

## Customer (portal)

Customers see only their own shipments: live tracking, proof of delivery, invoices, and a form to request a new shipment.

## Administrators

**Audit & Settings** has a tab for each area your role covers.

- **People:** add a login (they get a temporary password, shown once, to give them directly), change roles, link drivers to their worker record and portal users to their customer, disable an account (signs them out everywhere), reset a password, unlock, or reset two-step verification for a lost phone.
- **Roles:** the built-in roles and custom ones. Tick permissions and save; people with the role get the change within 15 minutes. You can't grant or remove administration permissions you don't have yourself (they show a lock), and roles that carry more administration access than yours are read-only for you.
- **Settings:** the organisation's name, GSTIN, address and timezone (printed on invoices and lorry receipts), and the rules the system checks: how early to warn about expiring documents, minimum rest between trips and maximum duty per trip.
- **Configuration:** expense categories, the ledger account each is booked to, and when a receipt is required.
- **Audit log:** every important change and sign-in, with before and after values. Entries can't be edited or deleted.
- **System health:** whether the database, document search, file storage and background jobs are working.
- **Companies** (platform administrators only): suspend or reactivate a company. Suspension signs its people out at once; its data is kept.

Safeguards: you can't change your own roles or disable yourself, and the system refuses a change that would leave nobody able to manage users.

## Importing from a spreadsheet

Vehicles, workers and customers can be imported from CSV files.

1. Choose **Import** on the list page, then **Download the template** for the column names and an example row. An **Export** file also works as a template.
2. Fill it in (one record per row) and save as **CSV UTF-8**. Dates can be written 2025-04-01 or 01/04/2025 (day first). Vehicle types and branches are matched by name.
3. Choose the file. TransAxis checks every row with the same rules as the forms and shows what will happen: new records, records that already exist (left unchanged), and rows with errors and the reason.
4. Nothing is saved until you choose **Import N new records**, and that button stays off while any row has an error. Fix the rows in your spreadsheet and choose the file again.

Up to 2,000 rows per file. Each import is recorded in the audit log.
