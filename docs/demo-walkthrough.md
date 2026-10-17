# Demo walkthrough

A 20-minute tour that shows each role and the main safeguards. All accounts use the password **`Demo@12345`**; the data is fictional and resets with `npm run db:seed -- --reset`. Use a private browser window per account if you want several signed in at once.

## 1. The company at a glance (owner)

Sign in as **`owner@kaveri.demo`**.

1. **Dashboard:** today's trips, fleet availability, documents expiring, and money owed.
2. Press **Ctrl+K** and type part of a registration number with spaces, for example `TN 01`. Pick a vehicle to open it. Try a trip number too.
3. **AI Assistant:** ask *"What is the detention charge for Coromandel?"* Click the source number to see the contract passage. Then ask *"What was our profit last quarter?"* and follow up with *"and the quarter before?"*; the period carries over. Without an API key the answers are in a labelled mock mode that quotes passages and figures directly.

## 2. Plan and run a trip (dispatcher)

Sign in as **`dispatch@kaveri.demo`**.

1. **Dispatch Board:** pick an approved booking in **To plan** and plan the trip. In the assignment drawer, choose a vehicle and driver; the drawer explains warnings such as an expiring permit or too little rest, and blocks assignments that break a rule.
2. Open the trip: run the inspection, add seals, and dispatch it.
3. **Live Fleet Map:** vehicles move along their routes (positions are simulated and labelled), with ETA and its method.
4. Open **Vehicles** and try to edit one: the dispatcher can view but not edit, and the API refuses the change too.

## 3. Out on the road (driver, phone-sized window)

Sign in as **`driver@kaveri.demo`** with the browser narrowed to phone width.

1. **My trips:** open today's trip, record a milestone, check in, and add an expense with a photo.
2. **My pay:** earnings and settlements so far.

## 4. Safety (control room)

Sign in as **`control@kaveri.demo`**.

1. **Control Room:** live alerts by severity. Acknowledge one and resolve it with a note.
2. **Incidents:** open an incident, assign it and add an update.

## 5. Money (accountant)

Sign in as **`finance@kaveri.demo`**.

1. **Invoices & Collections → Ready to invoice:** invoice a customer's delivered bookings and print the GST invoice.
2. Record the payment with TDS.
3. **Expenses:** approve one claim and reject another with a reason.
4. **Settlements:** preview a driver's pay for the period, then draft, approve and pay it, and print the pay statement.
5. **Finance → Overview → Trial balance:** still balanced.

## 6. The customer's view (portal)

Sign in as **`customer@kaveri.demo`**: track a shipment, view its proof of delivery and invoices, and request a new shipment. Only Coromandel Cement's own records appear.

## 7. Administration and security (owner)

Back as **`owner@kaveri.demo`**, open **Audit & Settings**.

1. **People → Add person:** create `new.dispatcher@kaveri.demo` with the Dispatcher role. Copy the temporary password from the dialog (it is shown once).
2. In a private window, sign in as that person with the temporary password. Only the **Choose your password** screen appears; the API refuses everything else until the password is changed.
3. Click your name → **My account** → **Set up** two-step verification, scan the QR code with an authenticator app and enter the code. Sign out and in again: the code is now asked for after the password.
4. Back in the owner's window, **Roles:** create a role "User administrator" with only *View users* and *Create, edit and deactivate users and roles*. Note the lock on administration permissions the owner doesn't hold, such as *Manage company tenants*.
5. Give that role to someone, sign in as them, and try to reset the owner's password: refused, because the owner has more administration access.
6. **Settings:** change *Minimum rest between trips* and save; the assignment drawer uses the new value.
7. **Audit log:** filter by *People* to see every step above with before and after values.
8. Sign in as **`maintenance@kaveri.demo`** (owners can export but not add vehicles): **Vehicles → Export**, then **Import** the same file. Every row shows *Exists* and nothing changes. Add a row with a made-up registration number and an unknown vehicle type, and choose the file again: the check names the bad row, and nothing is saved until it's fixed.

## 8. Tenants and isolation

1. Sign in as **`owner@sahyadri.demo`**: a different company, with only its own vehicles and records. A Kaveri vehicle's address returns "not found".
2. Sign in as **`admin@transaxis.demo`** (platform administrator) → **Audit & Settings → Companies:** suspend Sahyadri with a reason. The Sahyadri window is signed out on its next action and can't sign in again. Reactivate it.
3. As the platform administrator, **System health** shows the database, document search, storage and background jobs.
