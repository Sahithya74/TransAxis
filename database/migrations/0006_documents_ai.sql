CREATE TABLE `ai_queries` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`question` text NOT NULL,
	`route` enum('document','structured','hybrid','clarify') NOT NULL,
	`mode` enum('claude','mock') NOT NULL,
	`model` varchar(80),
	`answer` text NOT NULL,
	`period` json,
	`citations` json NOT NULL,
	`structured` json NOT NULL,
	`warnings` json NOT NULL,
	`latency_ms` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_queries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_chunks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`document_id` bigint unsigned NOT NULL,
	`seq` int NOT NULL,
	`page` int,
	`section` varchar(255),
	`content` text NOT NULL,
	`token_count` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `document_chunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_document_chunks_seq` UNIQUE(`document_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`title` varchar(200) NOT NULL,
	`classification` enum('general','operations','finance','hr','management') NOT NULL,
	`doc_type` enum('policy','contract','sop','rate_sheet','report','other') NOT NULL DEFAULT 'other',
	`original_name` varchar(255) NOT NULL,
	`mime` varchar(120) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`sha256` char(64) NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`replaces_id` bigint unsigned,
	`status` enum('queued','processing','ready','failed','superseded') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`error` varchar(500),
	`page_count` int,
	`chunk_count` int NOT NULL DEFAULT 0,
	`embedding_model` varchar(80),
	`uploaded_by` bigint unsigned,
	`processed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_documents_storage_key` UNIQUE(`storage_key`)
);
--> statement-breakpoint
ALTER TABLE `ai_queries` ADD CONSTRAINT `ai_queries_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_queries` ADD CONSTRAINT `ai_queries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_chunks` ADD CONSTRAINT `document_chunks_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_chunks` ADD CONSTRAINT `document_chunks_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_ai_queries_user` ON `ai_queries` (`org_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_document_chunks_org` ON `document_chunks` (`org_id`);--> statement-breakpoint
CREATE INDEX `ix_documents_org_status` ON `documents` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_documents_org_class` ON `documents` (`org_id`,`classification`);