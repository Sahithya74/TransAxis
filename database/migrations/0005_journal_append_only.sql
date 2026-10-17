-- Posted journal lines are permanent. Corrections are made with reversal entries, never by editing or
-- deleting lines, so the books can always be reconstructed. Enforced in the database itself.
CREATE TRIGGER `trg_journal_lines_no_update` BEFORE UPDATE ON `journal_lines`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'journal_lines is append-only: post a reversal entry instead of editing';
--> statement-breakpoint
CREATE TRIGGER `trg_journal_lines_no_delete` BEFORE DELETE ON `journal_lines`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'journal_lines is append-only: post a reversal entry instead of deleting';
