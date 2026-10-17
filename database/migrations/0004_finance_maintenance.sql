CREATE TABLE `advance_recoveries` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`settlement_id` bigint unsigned NOT NULL,
	`advance_id` bigint unsigned NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	CONSTRAINT `advance_recoveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_notes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`note_no` varchar(24) NOT NULL,
	`invoice_id` bigint unsigned NOT NULL,
	`note_date` date NOT NULL,
	`reason` varchar(255) NOT NULL,
	`taxable` decimal(14,2) NOT NULL,
	`tax` decimal(14,2) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	`journal_entry_id` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `credit_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_credit_notes_org_no` UNIQUE(`org_id`,`note_no`)
);
--> statement-breakpoint
CREATE TABLE `driver_advances` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned,
	`given_on` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`recovered` decimal(14,2) NOT NULL DEFAULT '0.00',
	`mode` enum('cash','bank','upi') NOT NULL,
	`purpose` varchar(255),
	`journal_entry_id` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `driver_advances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `driver_deductions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned,
	`deduction_type` enum('cash_shortfall','damage','fine','loan_recovery','other') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`reason` varchar(255) NOT NULL,
	`deducted_on` date NOT NULL,
	`settlement_id` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `driver_deductions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `driver_earnings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned,
	`earning_type` enum('trip_pay','daily_allowance','on_time_bonus','adjustment') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`explanation` json NOT NULL,
	`earned_on` date NOT NULL,
	`settlement_id` bigint unsigned,
	`journal_entry_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `driver_earnings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_earnings_trip_worker_type` UNIQUE(`trip_id`,`worker_id`,`earning_type`)
);
--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`name` varchar(80) NOT NULL,
	`account_key` varchar(40) NOT NULL,
	`is_trip_expense` boolean NOT NULL DEFAULT true,
	`requires_receipt_above` decimal(14,2),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `expense_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_expense_categories_org_name` UNIQUE(`org_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`category_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned,
	`vehicle_id` bigint unsigned,
	`worker_id` bigint unsigned,
	`vendor_id` bigint unsigned,
	`expense_date` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`payment_mode` enum('cash','bank','upi','card','fuel_card','fastag','driver_paid','vendor_credit') NOT NULL,
	`description` varchar(255) NOT NULL,
	`receipt_file_id` bigint unsigned,
	`status` enum('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
	`submitted_by` bigint unsigned,
	`decided_by` bigint unsigned,
	`decided_at` datetime(3),
	`rejection_reason` varchar(255),
	`journal_entry_id` bigint unsigned,
	`settlement_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fuel_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`vehicle_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned,
	`worker_id` bigint unsigned,
	`vendor_id` bigint unsigned,
	`filled_at` datetime(3) NOT NULL,
	`odometer_km` decimal(12,1) NOT NULL,
	`litres` decimal(10,2) NOT NULL,
	`price_per_litre` decimal(8,2) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`payment_mode` enum('cash','bank','upi','card','fuel_card','fastag','driver_paid','vendor_credit') NOT NULL,
	`full_tank` boolean NOT NULL DEFAULT true,
	`station_name` varchar(120),
	`kmpl` decimal(6,2),
	`anomaly` boolean NOT NULL DEFAULT false,
	`anomaly_reasons` json,
	`reviewed_by` bigint unsigned,
	`review_note` varchar(255),
	`receipt_file_id` bigint unsigned,
	`journal_entry_id` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `fuel_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`invoice_id` bigint unsigned NOT NULL,
	`booking_id` bigint unsigned,
	`trip_id` bigint unsigned,
	`description` varchar(255) NOT NULL,
	`sac` varchar(8) NOT NULL DEFAULT '9965',
	`amount` decimal(14,2) NOT NULL,
	CONSTRAINT `invoice_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_invoice_lines_booking` UNIQUE(`booking_id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`invoice_no` varchar(24) NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`invoice_date` date NOT NULL,
	`due_date` date NOT NULL,
	`gst_mode` enum('rcm_5','forward_12','forward_5') NOT NULL,
	`place_of_supply` varchar(80),
	`intra_state` boolean NOT NULL,
	`taxable` decimal(14,2) NOT NULL,
	`cgst` decimal(14,2) NOT NULL DEFAULT '0.00',
	`sgst` decimal(14,2) NOT NULL DEFAULT '0.00',
	`igst` decimal(14,2) NOT NULL DEFAULT '0.00',
	`reverse_charge_tax` decimal(14,2) NOT NULL DEFAULT '0.00',
	`total` decimal(14,2) NOT NULL,
	`paid` decimal(14,2) NOT NULL DEFAULT '0.00',
	`credited` decimal(14,2) NOT NULL DEFAULT '0.00',
	`status` enum('issued','partially_paid','paid','cancelled') NOT NULL DEFAULT 'issued',
	`notes` varchar(500),
	`cancel_reason` varchar(255),
	`journal_entry_id` bigint unsigned,
	`created_by` bigint unsigned,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_invoices_org_no` UNIQUE(`org_id`,`invoice_no`)
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`entry_no` varchar(24) NOT NULL,
	`entry_date` date NOT NULL,
	`memo` varchar(255) NOT NULL,
	`source_type` enum('invoice','credit_note','receipt','expense','fuel','work_order','earning','advance','settlement','manual','reversal') NOT NULL,
	`source_id` bigint unsigned,
	`idempotency_key` varchar(120) NOT NULL,
	`reversal_of_id` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `journal_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_journal_org_no` UNIQUE(`org_id`,`entry_no`),
	CONSTRAINT `uq_journal_org_idem` UNIQUE(`org_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`entry_id` bigint unsigned NOT NULL,
	`account_id` bigint unsigned NOT NULL,
	`debit` decimal(14,2) NOT NULL DEFAULT '0.00',
	`credit` decimal(14,2) NOT NULL DEFAULT '0.00',
	`trip_id` bigint unsigned,
	`vehicle_id` bigint unsigned,
	`customer_id` bigint unsigned,
	`vendor_id` bigint unsigned,
	`worker_id` bigint unsigned,
	`memo` varchar(255),
	CONSTRAINT `journal_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ledger_accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`code` varchar(16) NOT NULL,
	`name` varchar(120) NOT NULL,
	`account_type` enum('asset','liability','equity','income','expense') NOT NULL,
	`system_key` varchar(40),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ledger_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_accounts_org_code` UNIQUE(`org_id`,`code`),
	CONSTRAINT `uq_accounts_org_key` UNIQUE(`org_id`,`system_key`)
);
--> statement-breakpoint
CREATE TABLE `receipt_allocations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`receipt_id` bigint unsigned NOT NULL,
	`invoice_id` bigint unsigned NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `receipt_allocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`receipt_no` varchar(24) NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`received_on` date NOT NULL,
	`mode` enum('bank','upi','cheque','cash') NOT NULL,
	`reference` varchar(80),
	`amount` decimal(14,2) NOT NULL,
	`tds_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`unallocated` decimal(14,2) NOT NULL DEFAULT '0.00',
	`notes` varchar(255),
	`journal_entry_id` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_receipts_org_no` UNIQUE(`org_id`,`receipt_no`)
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`settlement_no` varchar(24) NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`period_from` date NOT NULL,
	`period_to` date NOT NULL,
	`earnings` decimal(14,2) NOT NULL,
	`reimbursements` decimal(14,2) NOT NULL,
	`deductions` decimal(14,2) NOT NULL,
	`advances_recovered` decimal(14,2) NOT NULL,
	`net` decimal(14,2) NOT NULL,
	`status` enum('draft','approved','paid','cancelled') NOT NULL DEFAULT 'draft',
	`breakdown` json NOT NULL,
	`approved_by` bigint unsigned,
	`approved_at` datetime(3),
	`paid_on` date,
	`paid_mode` enum('cash','bank','upi'),
	`payment_reference` varchar(80),
	`journal_entry_id` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_settlements_org_no` UNIQUE(`org_id`,`settlement_no`)
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`reason` enum('purchase','issue','return','adjustment') NOT NULL,
	`work_order_id` bigint unsigned,
	`unit_cost` decimal(12,2),
	`note` varchar(255),
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `inventory_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_schedules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`vehicle_id` bigint unsigned NOT NULL,
	`task` varchar(120) NOT NULL,
	`every_km` int,
	`every_days` int,
	`last_done_km` decimal(12,1),
	`last_done_on` date,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `maintenance_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_schedules_vehicle_task` UNIQUE(`vehicle_id`,`task`)
);
--> statement-breakpoint
CREATE TABLE `spare_parts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`part_no` varchar(40) NOT NULL,
	`name` varchar(120) NOT NULL,
	`unit` varchar(16) NOT NULL DEFAULT 'pcs',
	`stock_qty` decimal(12,2) NOT NULL DEFAULT '0.00',
	`reorder_level` decimal(12,2) NOT NULL DEFAULT '0.00',
	`unit_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `spare_parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_parts_org_no` UNIQUE(`org_id`,`part_no`)
);
--> statement-breakpoint
CREATE TABLE `tyres` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`serial_no` varchar(40) NOT NULL,
	`brand` varchar(60) NOT NULL,
	`size` varchar(40) NOT NULL,
	`status` enum('in_stock','fitted','removed','scrapped') NOT NULL DEFAULT 'in_stock',
	`vehicle_id` bigint unsigned,
	`position` enum('FL','FR','RLO','RLI','RRO','RRI','R2LO','R2LI','R2RO','R2RI','SPARE'),
	`fitted_on` date,
	`fitted_at_km` decimal(12,1),
	`km_run_before` decimal(12,1) NOT NULL DEFAULT '0.0',
	`purchase_cost` decimal(14,2),
	`purchased_on` date,
	`expected_life_km` int,
	`notes` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `tyres_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tyres_org_serial` UNIQUE(`org_id`,`serial_no`)
);
--> statement-breakpoint
CREATE TABLE `work_order_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`work_order_id` bigint unsigned NOT NULL,
	`kind` enum('part','labour','other') NOT NULL,
	`part_id` bigint unsigned,
	`description` varchar(160) NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`unit_cost` decimal(12,2) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `work_order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`wo_no` varchar(24) NOT NULL,
	`vehicle_id` bigint unsigned NOT NULL,
	`schedule_id` bigint unsigned,
	`wo_type` enum('preventive','breakdown','accident','inspection','tyre','other') NOT NULL,
	`priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
	`status` enum('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
	`title` varchar(160) NOT NULL,
	`description` text,
	`vendor_id` bigint unsigned,
	`odometer_km` decimal(12,1),
	`opened_at` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`completed_at` datetime(3),
	`vehicle_status_before` varchar(24),
	`parts_cost` decimal(14,2) NOT NULL DEFAULT '0.00',
	`labour_cost` decimal(14,2) NOT NULL DEFAULT '0.00',
	`other_cost` decimal(14,2) NOT NULL DEFAULT '0.00',
	`total` decimal(14,2) NOT NULL DEFAULT '0.00',
	`payment_mode` enum('cash','bank','upi','vendor_credit'),
	`cancel_reason` varchar(255),
	`journal_entry_id` bigint unsigned,
	`created_by` bigint unsigned,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `work_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_work_orders_org_no` UNIQUE(`org_id`,`wo_no`)
);
--> statement-breakpoint
ALTER TABLE `vehicles` ADD `fuel_tank_litres` int;--> statement-breakpoint
ALTER TABLE `advance_recoveries` ADD CONSTRAINT `advance_recoveries_settlement_id_settlements_id_fk` FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advance_recoveries` ADD CONSTRAINT `advance_recoveries_advance_id_driver_advances_id_fk` FOREIGN KEY (`advance_id`) REFERENCES `driver_advances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `credit_notes_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `credit_notes_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `credit_notes_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD CONSTRAINT `credit_notes_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_advances` ADD CONSTRAINT `driver_advances_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_advances` ADD CONSTRAINT `driver_advances_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_advances` ADD CONSTRAINT `driver_advances_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_advances` ADD CONSTRAINT `driver_advances_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_advances` ADD CONSTRAINT `driver_advances_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_deductions` ADD CONSTRAINT `driver_deductions_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_deductions` ADD CONSTRAINT `driver_deductions_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_deductions` ADD CONSTRAINT `driver_deductions_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_deductions` ADD CONSTRAINT `driver_deductions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_earnings` ADD CONSTRAINT `driver_earnings_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_earnings` ADD CONSTRAINT `driver_earnings_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_earnings` ADD CONSTRAINT `driver_earnings_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_earnings` ADD CONSTRAINT `driver_earnings_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_category_id_expense_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_vendor_id_vendors_id_fk` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_receipt_file_id_files_id_fk` FOREIGN KEY (`receipt_file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_submitted_by_users_id_fk` FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_decided_by_users_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_vendor_id_vendors_id_fk` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_receipt_file_id_files_id_fk` FOREIGN KEY (`receipt_file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fuel_logs` ADD CONSTRAINT `fuel_logs_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_booking_id_bookings_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_entry_id_journal_entries_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_account_id_ledger_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_vendor_id_vendors_id_fk` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_receipt_id_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_part_id_spare_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `spare_parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_work_order_id_work_orders_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenance_schedules` ADD CONSTRAINT `maintenance_schedules_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenance_schedules` ADD CONSTRAINT `maintenance_schedules_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `spare_parts` ADD CONSTRAINT `spare_parts_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tyres` ADD CONSTRAINT `tyres_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tyres` ADD CONSTRAINT `tyres_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD CONSTRAINT `work_order_items_work_order_id_work_orders_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD CONSTRAINT `work_order_items_part_id_spare_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `spare_parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_schedule_id_maintenance_schedules_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `maintenance_schedules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_vendor_id_vendors_id_fk` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_recoveries_settlement` ON `advance_recoveries` (`settlement_id`);--> statement-breakpoint
CREATE INDEX `ix_credit_notes_invoice` ON `credit_notes` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `ix_advances_worker` ON `driver_advances` (`org_id`,`worker_id`);--> statement-breakpoint
CREATE INDEX `ix_deductions_worker` ON `driver_deductions` (`org_id`,`worker_id`,`settlement_id`);--> statement-breakpoint
CREATE INDEX `ix_earnings_worker` ON `driver_earnings` (`org_id`,`worker_id`,`settlement_id`);--> statement-breakpoint
CREATE INDEX `ix_expenses_org_status` ON `expenses` (`org_id`,`status`,`expense_date`);--> statement-breakpoint
CREATE INDEX `ix_expenses_trip` ON `expenses` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_expenses_worker` ON `expenses` (`worker_id`);--> statement-breakpoint
CREATE INDEX `ix_fuel_vehicle_time` ON `fuel_logs` (`vehicle_id`,`filled_at`);--> statement-breakpoint
CREATE INDEX `ix_fuel_org_time` ON `fuel_logs` (`org_id`,`filled_at`);--> statement-breakpoint
CREATE INDEX `ix_fuel_trip` ON `fuel_logs` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_invoice_lines_invoice` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `ix_invoices_org_customer` ON `invoices` (`org_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_invoices_org_due` ON `invoices` (`org_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `ix_journal_org_date` ON `journal_entries` (`org_id`,`entry_date`);--> statement-breakpoint
CREATE INDEX `ix_journal_source` ON `journal_entries` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `ix_lines_entry` ON `journal_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `ix_lines_account` ON `journal_lines` (`org_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `ix_lines_trip` ON `journal_lines` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_lines_vehicle` ON `journal_lines` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `ix_lines_customer` ON `journal_lines` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_lines_worker` ON `journal_lines` (`worker_id`);--> statement-breakpoint
CREATE INDEX `ix_allocations_receipt` ON `receipt_allocations` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `ix_allocations_invoice` ON `receipt_allocations` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `ix_receipts_org_customer` ON `receipts` (`org_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_settlements_worker` ON `settlements` (`org_id`,`worker_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_movements_part` ON `inventory_movements` (`part_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_schedules_org` ON `maintenance_schedules` (`org_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `ix_tyres_vehicle` ON `tyres` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `ix_wo_items_wo` ON `work_order_items` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `ix_work_orders_org_status` ON `work_orders` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_work_orders_vehicle` ON `work_orders` (`vehicle_id`,`opened_at`);