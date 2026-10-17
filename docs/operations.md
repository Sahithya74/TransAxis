# Operations

Running, monitoring, backing up and restoring TransAxis. Commands are for Windows PowerShell from the repository root, matching the demo machine; the same steps apply elsewhere with the usual path changes.

## What has state

| Store | Where | Back up? |
|---|---|---|
| MySQL database `transaxis` | Dev instance data in `%LOCALAPPDATA%\TransAxis\mysql-dev\data`, port 3307 | **Yes**: everything except file bytes and vectors |
| Uploaded files (vehicle documents, PODs, receipts, library documents) | `storage/uploads` (`UPLOAD_DIR`) | **Yes**, together with the database |
| Vector index | `storage/qdrant` (`QDRANT_PATH`) | Optional: can be rebuilt from the documents |
| Secrets | `.env` | Keep a copy in a password manager, never in a backup bucket next to the data |

## Starting and stopping

| Task | Command |
|---|---|
| Start the dev MySQL instance (after every reboot) | `npm run mysql:start` |
| Check it | `npm run mysql:status` |
| Run everything for development | `npm run dev` (web on 5173, API on 4000, RAG on 8001) |
| Run a shareable demo | `npm run share` (see the README) |
| Apply new migrations | `npm run db:migrate` |
| Reset the demo data | `npm run db:seed -- --reset` |

Background jobs (GPS simulation, alert evaluation, check-in monitoring, escalation, retention, document ingestion) run inside the API process. They are on by default outside tests; `JOBS_ENABLED=false` turns them off.

## Monitoring

- **Administration → System health** (owners and platform administrators): API version and uptime, database response time and migration count, the document service (mode, embeddings, queued and failed documents), whether uploads are writable, and each background job's lease. A job shows **Stopped** when its lease lapsed more than five minutes ago.
- **Health endpoints** for scripts and load balancers: `GET /api/v1/health` (API and database, returns 503 when the database is down) and `GET http://127.0.0.1:8001/health` (RAG service, local only).
- **Logs:** the API writes JSON lines (pino) to standard output with a request ID per request. The same ID is in error responses and audit entries, so a user's "request ID" from an error message finds the log line.
- **Audit log:** Administration → Audit log, filterable by kind of event, person and date.

## Backups

Back up the database and the uploads folder at the same time, so file references and files match.

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$dir = "D:\Backups\transaxis\$stamp"
New-Item -ItemType Directory -Force $dir | Out-Null

# 1. Database: consistent snapshot without locking writers. --triggers keeps the append-only rules.
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe' `
  -h 127.0.0.1 -P 3307 -u root -p `
  --single-transaction --routines --triggers --events --set-gtid-purged=OFF `
  --databases transaxis --result-file "$dir\transaxis.sql"

# 2. Uploaded files.
Compress-Archive -Path storage\uploads\* -DestinationPath "$dir\uploads.zip"
```

- Run it daily (Task Scheduler) and keep at least 7 daily and 4 weekly copies, one of them off the machine.
- `mysqldump` asks for the root password; for a scheduled task, put the credentials in a MySQL option file readable only by the backup account (`--defaults-extra-file`).
- Encrypt copies that leave the machine: they contain personal data (drivers' details, customers) and financial records.

## Restoring

Restore into a fresh database first and check it before switching over.

```powershell
# 1. Stop the API (and `npm run dev` / `npm run share`) so nothing writes during the restore.
# 2. Load the dump. It recreates the transaxis database, its tables and triggers.
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' -h 127.0.0.1 -P 3307 -u root -p -e "source D:/Backups/transaxis/20261017-0200/transaxis.sql"

# 3. Put the files back.
Expand-Archive -Path D:\Backups\transaxis\20261017-0200\uploads.zip -DestinationPath storage\uploads -Force

# 4. Bring the schema up to date if the backup is older than the code.
npm run db:migrate
```

Then start the API and check:

1. `GET /api/v1/health` reports the database up.
2. **System health** shows the expected migration count and writable uploads.
3. Sign in, open a vehicle document and a library document: both download.
4. **Finance → Overview → Trial balance** balances.

**Vectors:** after a restore, or if `storage/qdrant` is lost, keyword search keeps working because passages are in MySQL. Rebuild vector search by choosing **Reprocess** on each document in **Documents**. On startup and every 30 minutes the RAG service also removes vectors whose passages no longer exist.

### Restore drill

Test a restore once a month into a scratch instance (for example a second MySQL data directory on another port), following the checks above. A backup that has never been restored is not a backup.

## Upgrades

1. Back up (above).
2. `git pull`, then `npm install` and, if `services/rag/requirements*.txt` changed, `npm run rag:setup`.
3. `npm run db:migrate`. Migrations only move forward; to undo one, restore the backup.
4. `npm run build` and restart.

## Common problems

| Symptom | Cause and fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:3307` after a reboot | The dev MySQL instance isn't a Windows service. Run `npm run mysql:start` |
| Everyone is signed out after a restart | Expected only if `JWT_ACCESS_SECRET` changed. Refresh sessions survive restarts otherwise |
| Two-step codes stop working for everyone | `TOTP_ENCRYPTION_KEY` (or `JWT_ACCESS_SECRET`, if the key isn't set) changed, so stored secrets can't be read. Restore the old value, or have an administrator reset two-step for each person |
| Documents stay **Queued** | The RAG service isn't running or `RAG_SERVICE_URL` / `RAG_SERVICE_SECRET` don't match. Check `http://127.0.0.1:8001/health`; the ingest job retries every 15 seconds |
| The assistant says it's in mock mode | No `ANTHROPIC_API_KEY`. Answers still quote passages and figures |
| Someone is locked out | After 5 wrong attempts accounts lock for 15 minutes. An administrator can unlock them under Administration → People |
| `npm run share` says port 7844 is blocked | The network blocks Cloudflare tunnels (common on campus Wi-Fi). Use another network such as a phone hotspot |
