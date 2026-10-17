CREATE TABLE `driver_checkins` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`due_at` datetime(3) NOT NULL,
	`checked_in_at` datetime(3),
	`status` enum('pending','ok','missed') NOT NULL DEFAULT 'pending',
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`note` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `driver_checkins_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_checkins_trip_due` UNIQUE(`trip_id`,`due_at`)
);
--> statement-breakpoint
CREATE TABLE `geofences` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`kind` enum('depot','customer_site','restricted','checkpoint') NOT NULL,
	`lat` decimal(9,6) NOT NULL,
	`lng` decimal(9,6) NOT NULL,
	`radius_m` int NOT NULL,
	`location_id` bigint unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `geofences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gps_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`vehicle_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned,
	`recorded_at` datetime(3) NOT NULL,
	`lat` decimal(9,6) NOT NULL,
	`lng` decimal(9,6) NOT NULL,
	`speed_kmph` decimal(5,1),
	`heading_deg` int,
	`accuracy_m` int,
	`source` enum('simulated','device','manual') NOT NULL,
	`is_simulated` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `gps_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incident_updates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`incident_id` bigint unsigned NOT NULL,
	`kind` enum('created','note','status_change','assignment','escalation') NOT NULL,
	`body` text,
	`from_status` enum('open','investigating','escalated','resolved','closed'),
	`to_status` enum('open','investigating','escalated','resolved','closed'),
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `incident_updates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`incident_no` varchar(24) NOT NULL,
	`incident_type` enum('accident','breakdown','theft','cargo_damage','medical','harassment','road_block','sos','other') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL,
	`status` enum('open','investigating','escalated','resolved','closed') NOT NULL DEFAULT 'open',
	`title` varchar(160) NOT NULL,
	`description` text,
	`trip_id` bigint unsigned,
	`vehicle_id` bigint unsigned,
	`driver_id` bigint unsigned,
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`location_text` varchar(255),
	`reported_by` bigint unsigned,
	`reported_at` datetime(3) NOT NULL,
	`assigned_to` bigint unsigned,
	`resolved_at` datetime(3),
	`resolution` text,
	`is_simulated` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_incidents_org_no` UNIQUE(`org_id`,`incident_no`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`category` enum('alert','incident','trip','compliance','checkin','system') NOT NULL,
	`priority` enum('low','normal','high','critical') NOT NULL DEFAULT 'normal',
	`title` varchar(160) NOT NULL,
	`body` varchar(500),
	`link` varchar(255),
	`entity_type` varchar(48),
	`entity_id` bigint unsigned,
	`dedupe_key` varchar(160) NOT NULL,
	`read_at` datetime(3),
	`acknowledged_at` datetime(3),
	`escalated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_notifications_user_dedupe` UNIQUE(`user_id`,`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `safety_alerts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`alert_type` enum('route_deviation','unexpected_stop','overspeed','gps_stale','geofence_breach','late_arrival','missed_checkin','sos') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL,
	`status` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
	`title` varchar(160) NOT NULL,
	`detail` varchar(500),
	`trip_id` bigint unsigned,
	`vehicle_id` bigint unsigned,
	`driver_id` bigint unsigned,
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`dedupe_key` varchar(120),
	`is_simulated` boolean NOT NULL DEFAULT false,
	`raised_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`occurrences` int NOT NULL DEFAULT 1,
	`acknowledged_at` datetime(3),
	`acknowledged_by` bigint unsigned,
	`resolved_at` datetime(3),
	`resolved_by` bigint unsigned,
	`resolution_note` varchar(255),
	`auto_resolved` boolean NOT NULL DEFAULT false,
	`incident_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `safety_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_alerts_org_dedupe` UNIQUE(`org_id`,`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_last_positions` (
	`vehicle_id` bigint unsigned NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned,
	`recorded_at` datetime(3) NOT NULL,
	`lat` decimal(9,6) NOT NULL,
	`lng` decimal(9,6) NOT NULL,
	`speed_kmph` decimal(5,1),
	`heading_deg` int,
	`source` enum('simulated','device','manual') NOT NULL,
	`is_simulated` boolean NOT NULL DEFAULT false,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `vehicle_last_positions_vehicle_id` PRIMARY KEY(`vehicle_id`)
);
--> statement-breakpoint
ALTER TABLE `driver_checkins` ADD CONSTRAINT `driver_checkins_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_checkins` ADD CONSTRAINT `driver_checkins_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_checkins` ADD CONSTRAINT `driver_checkins_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `geofences` ADD CONSTRAINT `geofences_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `geofences` ADD CONSTRAINT `geofences_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gps_events` ADD CONSTRAINT `gps_events_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gps_events` ADD CONSTRAINT `gps_events_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gps_events` ADD CONSTRAINT `gps_events_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_updates` ADD CONSTRAINT `incident_updates_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_updates` ADD CONSTRAINT `incident_updates_incident_id_incidents_id_fk` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incident_updates` ADD CONSTRAINT `incident_updates_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_driver_id_workers_id_fk` FOREIGN KEY (`driver_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_reported_by_users_id_fk` FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_assigned_to_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safety_alerts` ADD CONSTRAINT `safety_alerts_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safety_alerts` ADD CONSTRAINT `safety_alerts_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safety_alerts` ADD CONSTRAINT `safety_alerts_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safety_alerts` ADD CONSTRAINT `safety_alerts_driver_id_workers_id_fk` FOREIGN KEY (`driver_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safety_alerts` ADD CONSTRAINT `safety_alerts_acknowledged_by_users_id_fk` FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safety_alerts` ADD CONSTRAINT `safety_alerts_resolved_by_users_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicle_last_positions` ADD CONSTRAINT `vehicle_last_positions_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicle_last_positions` ADD CONSTRAINT `vehicle_last_positions_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicle_last_positions` ADD CONSTRAINT `vehicle_last_positions_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_checkins_org_status` ON `driver_checkins` (`org_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `ix_geofences_org` ON `geofences` (`org_id`,`kind`,`is_active`);--> statement-breakpoint
CREATE INDEX `ix_gps_trip_time` ON `gps_events` (`trip_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `ix_gps_vehicle_time` ON `gps_events` (`vehicle_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `ix_gps_org_time` ON `gps_events` (`org_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `ix_incident_updates_incident` ON `incident_updates` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_incidents_org_status` ON `incidents` (`org_id`,`status`,`reported_at`);--> statement-breakpoint
CREATE INDEX `ix_notifications_user` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_alerts_org_status` ON `safety_alerts` (`org_id`,`status`,`raised_at`);--> statement-breakpoint
CREATE INDEX `ix_alerts_trip` ON `safety_alerts` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_last_positions_org` ON `vehicle_last_positions` (`org_id`);