CREATE TABLE `audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned,
	`user_id` bigint unsigned,
	`action` varchar(64) NOT NULL,
	`entity_type` varchar(48),
	`entity_id` varchar(48),
	`summary` varchar(255),
	`before` json,
	`after` json,
	`ip` varchar(45),
	`user_agent` varchar(255),
	`request_id` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`city` varchar(80),
	`state` varchar(80),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_branches_org_name` UNIQUE(`org_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`mime` varchar(120) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`sha256` char(64) NOT NULL,
	`category` varchar(48) NOT NULL DEFAULT 'general',
	`entity_type` varchar(48),
	`entity_id` bigint unsigned,
	`uploaded_by` bigint unsigned,
	`captured_at` datetime(3),
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`note` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `files_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_files_storage_key` UNIQUE(`storage_key`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`key` varchar(100) NOT NULL,
	`request_hash` char(64) NOT NULL,
	`response_status` int,
	`response_body` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_idempotency_org_key` UNIQUE(`org_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `job_locks` (
	`name` varchar(64) NOT NULL,
	`locked_until` datetime(3) NOT NULL,
	`locked_by` varchar(64) NOT NULL,
	CONSTRAINT `job_locks_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `number_sequences` (
	`org_id` bigint unsigned NOT NULL,
	`scope` varchar(32) NOT NULL,
	`year` int NOT NULL,
	`next_value` int NOT NULL DEFAULT 1,
	CONSTRAINT `number_sequences_org_id_scope_year_pk` PRIMARY KEY(`org_id`,`scope`,`year`)
);
--> statement-breakpoint
CREATE TABLE `org_settings` (
	`org_id` bigint unsigned NOT NULL,
	`key` varchar(80) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `org_settings_org_id_key_pk` PRIMARY KEY(`org_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(160) NOT NULL,
	`legal_name` varchar(200),
	`gstin` varchar(20),
	`address_line` varchar(255),
	`city` varchar(80),
	`state` varchar(80),
	`country` varchar(2) NOT NULL DEFAULT 'IN',
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_organizations_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_password_reset_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`description` varchar(255) NOT NULL,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_permissions_key` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` bigint unsigned NOT NULL,
	`permission_id` bigint unsigned NOT NULL,
	CONSTRAINT `role_permissions_role_id_permission_id_pk` PRIMARY KEY(`role_id`,`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`key` varchar(48) NOT NULL,
	`name` varchar(120) NOT NULL,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_roles_org_key` UNIQUE(`org_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` bigint unsigned NOT NULL,
	`role_id` bigint unsigned NOT NULL,
	CONSTRAINT `user_roles_user_id_role_id_pk` PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`family_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`user_agent` varchar(255),
	`ip` varchar(45),
	`expires_at` datetime(3) NOT NULL,
	`rotated_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_used_at` datetime(3),
	CONSTRAINT `user_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_sessions_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`email` varchar(190) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`full_name` varchar(140) NOT NULL,
	`phone` varchar(32),
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`failed_login_count` int NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`last_login_at` datetime(3),
	`must_change_password` boolean NOT NULL DEFAULT false,
	`totp_secret_enc` varchar(255),
	`totp_enabled` boolean NOT NULL DEFAULT false,
	`worker_id` bigint unsigned,
	`customer_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_documents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`vehicle_id` bigint unsigned NOT NULL,
	`doc_type` enum('registration','insurance','fitness','permit','pollution','road_tax','other') NOT NULL,
	`document_no` varchar(80),
	`issued_on` date,
	`expires_on` date,
	`file_id` bigint unsigned,
	`notes` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `vehicle_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_types` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`name` varchar(80) NOT NULL,
	`body_type` enum('open','closed','container','reefer','tanker','flatbed','tipper','trailer','other') NOT NULL,
	`required_licence_class` varchar(16) NOT NULL,
	`default_payload_kg` decimal(12,3),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `vehicle_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_vehicle_types_org_name` UNIQUE(`org_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned,
	`vehicle_type_id` bigint unsigned NOT NULL,
	`registration_no` varchar(20) NOT NULL,
	`make` varchar(60),
	`model` varchar(60),
	`year` int,
	`ownership` enum('owned','leased','attached','hired') NOT NULL DEFAULT 'owned',
	`vendor_id` bigint unsigned,
	`payload_capacity_kg` decimal(12,3) NOT NULL,
	`volume_capacity_cbm` decimal(10,2),
	`fuel_type` enum('diesel','petrol','cng','lng','electric','other') NOT NULL DEFAULT 'diesel',
	`odometer_km` decimal(12,1) NOT NULL DEFAULT '0.0',
	`fuel_efficiency_kmpl` decimal(6,2),
	`status` enum('available','assigned','on_trip','under_maintenance','unavailable','retired') NOT NULL DEFAULT 'available',
	`notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `vehicles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_vehicles_org_reg` UNIQUE(`org_id`,`registration_no`)
);
--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `number_sequences` ADD CONSTRAINT `number_sequences_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `org_settings` ADD CONSTRAINT `org_settings_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_permissions_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicle_documents` ADD CONSTRAINT `vehicle_documents_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicle_documents` ADD CONSTRAINT `vehicle_documents_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicle_documents` ADD CONSTRAINT `vehicle_documents_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicle_types` ADD CONSTRAINT `vehicle_types_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_vehicle_type_id_vehicle_types_id_fk` FOREIGN KEY (`vehicle_type_id`) REFERENCES `vehicle_types`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_audit_org_created` ON `audit_logs` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_audit_user` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_files_entity` ON `files` (`org_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_user_sessions_user` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_user_sessions_family` ON `user_sessions` (`family_id`);--> statement-breakpoint
CREATE INDEX `ix_users_org` ON `users` (`org_id`);--> statement-breakpoint
CREATE INDEX `ix_vehicle_docs_vehicle` ON `vehicle_documents` (`vehicle_id`,`doc_type`);--> statement-breakpoint
CREATE INDEX `ix_vehicle_docs_expiry` ON `vehicle_documents` (`org_id`,`expires_on`);--> statement-breakpoint
CREATE INDEX `ix_vehicles_org_status` ON `vehicles` (`org_id`,`status`);