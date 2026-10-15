-- Audit log is an append-only record. Block UPDATE and DELETE at the database level so even a
-- bug or a compromised app credential cannot silently rewrite history.
CREATE TRIGGER `trg_audit_logs_no_update` BEFORE UPDATE ON `audit_logs`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE is not permitted';
--> statement-breakpoint
CREATE TRIGGER `trg_audit_logs_no_delete` BEFORE DELETE ON `audit_logs`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: DELETE is not permitted';
