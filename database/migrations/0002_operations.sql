CREATE TABLE `attendance` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`work_date` date NOT NULL,
	`status` enum('present','absent','leave','off','on_trip') NOT NULL,
	`check_in` datetime(3),
	`check_out` datetime(3),
	`source` enum('manual','trip','app') NOT NULL DEFAULT 'manual',
	`notes` varchar(255),
	`recorded_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `attendance_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_attendance_worker_date` UNIQUE(`worker_id`,`work_date`)
);
--> statement-breakpoint
CREATE TABLE `compensation_policies` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`applies_to` enum('driver','helper') NOT NULL,
	`basis` enum('fixed_per_trip','per_km','per_tonne','percent_of_freight','monthly_salary') NOT NULL,
	`rate` decimal(12,4) NOT NULL,
	`daily_allowance` decimal(10,2) NOT NULL DEFAULT '0.00',
	`on_time_bonus` decimal(10,2) NOT NULL DEFAULT '0.00',
	`min_per_trip` decimal(10,2),
	`effective_from` date NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`notes` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `compensation_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comp_policies_org_name` UNIQUE(`org_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `driver_licence_classes` (
	`licence_id` bigint unsigned NOT NULL,
	`licence_class` varchar(16) NOT NULL,
	CONSTRAINT `driver_licence_classes_licence_id_licence_class_pk` PRIMARY KEY(`licence_id`,`licence_class`)
);
--> statement-breakpoint
CREATE TABLE `driver_licences` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`licence_no` varchar(32) NOT NULL,
	`issuing_state` varchar(60),
	`issued_on` date,
	`valid_until` date NOT NULL,
	`verification` enum('unverified','verified','rejected') NOT NULL DEFAULT 'unverified',
	`verified_on` date,
	`verified_by` bigint unsigned,
	`file_id` bigint unsigned,
	`is_current` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `driver_licences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `duty_rosters` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`shift_type` enum('day','night','standby','off') NOT NULL,
	`notes` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `duty_rosters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`leave_type` enum('casual','sick','earned','unpaid','other') NOT NULL,
	`from_date` date NOT NULL,
	`to_date` date NOT NULL,
	`reason` varchar(255),
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`decided_by` bigint unsigned,
	`decided_at` datetime(3),
	`decision_note` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `leave_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `worker_documents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`doc_type` enum('id_proof','address_proof','medical_certificate','police_verification','training_certificate','employment_contract','other') NOT NULL,
	`document_no` varchar(80),
	`expires_on` date,
	`file_id` bigint unsigned,
	`notes` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `worker_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `worker_trainings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`training_type` enum('defensive_driving','hazmat','first_aid','fire_safety','induction','other') NOT NULL,
	`completed_on` date NOT NULL,
	`valid_until` date,
	`provider` varchar(120),
	`notes` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `worker_trainings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned,
	`employee_code` varchar(24) NOT NULL,
	`worker_type` enum('driver','helper','loader','mechanic','supervisor') NOT NULL,
	`full_name` varchar(140) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`alt_phone` varchar(32),
	`date_of_birth` date,
	`address` varchar(255),
	`blood_group` varchar(5),
	`emergency_contact_name` varchar(120),
	`emergency_contact_phone` varchar(32),
	`emergency_contact_relation` varchar(40),
	`base_monthly_salary` decimal(12,2),
	`employment_status` enum('active','suspended','terminated') NOT NULL DEFAULT 'active',
	`joined_on` date,
	`left_on` date,
	`compensation_policy_id` bigint unsigned,
	`medical_valid_until` date,
	`notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `workers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_workers_org_code` UNIQUE(`org_id`,`employee_code`)
);
--> statement-breakpoint
CREATE TABLE `customer_contacts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`designation` varchar(80),
	`phone` varchar(32),
	`email` varchar(190),
	`is_primary` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `customer_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_rate_cards` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`origin_city` varchar(80) NOT NULL,
	`destination_city` varchar(80) NOT NULL,
	`vehicle_type_id` bigint unsigned,
	`rate_basis` enum('per_trip','per_tonne','per_km') NOT NULL,
	`rate` decimal(12,2) NOT NULL,
	`loading_charge` decimal(10,2) NOT NULL DEFAULT '0.00',
	`unloading_charge` decimal(10,2) NOT NULL DEFAULT '0.00',
	`detention_free_hours` int NOT NULL DEFAULT 24,
	`detention_rate_per_hour` decimal(10,2) NOT NULL DEFAULT '0.00',
	`valid_from` date NOT NULL,
	`valid_to` date,
	`notes` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `customer_rate_cards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`code` varchar(24) NOT NULL,
	`name` varchar(160) NOT NULL,
	`legal_name` varchar(200),
	`gstin` varchar(15),
	`pan` varchar(10),
	`billing_address` varchar(255),
	`city` varchar(80),
	`state` varchar(80),
	`pincode` varchar(10),
	`phone` varchar(32),
	`email` varchar(190),
	`payment_terms_days` int NOT NULL DEFAULT 30,
	`credit_limit` decimal(14,2),
	`status` enum('active','on_hold','inactive') NOT NULL DEFAULT 'active',
	`notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customers_org_code` UNIQUE(`org_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned,
	`name` varchar(140) NOT NULL,
	`location_type` enum('customer_site','warehouse','depot','port','fuel_station','other') NOT NULL,
	`address_line` varchar(255),
	`city` varchar(80) NOT NULL,
	`state` varchar(80),
	`pincode` varchar(10),
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`contact_name` varchar(120),
	`contact_phone` varchar(32),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`origin_city` varchar(80) NOT NULL,
	`destination_city` varchar(80) NOT NULL,
	`distance_km` decimal(8,1) NOT NULL,
	`expected_duration_min` int NOT NULL,
	`polyline` json NOT NULL,
	`toll_estimate` decimal(10,2),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `routes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_routes_org_name` UNIQUE(`org_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`code` varchar(24) NOT NULL,
	`name` varchar(160) NOT NULL,
	`vendor_type` enum('workshop','fuel_station','subcontractor','freight_agent','parts_supplier','tyre_dealer','insurer','other') NOT NULL,
	`gstin` varchar(15),
	`pan` varchar(10),
	`address` varchar(255),
	`city` varchar(80),
	`state` varchar(80),
	`contact_name` varchar(120),
	`phone` varchar(32),
	`email` varchar(190),
	`payment_terms_days` int NOT NULL DEFAULT 30,
	`status` enum('active','on_hold','inactive') NOT NULL DEFAULT 'active',
	`notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `vendors_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_vendors_org_code` UNIQUE(`org_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `booking_charges` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`booking_id` bigint unsigned NOT NULL,
	`charge_type` enum('freight','loading','unloading','detention','halting','toll','other') NOT NULL,
	`description` varchar(120),
	`amount` decimal(14,2) NOT NULL,
	`is_taxable` boolean NOT NULL DEFAULT true,
	CONSTRAINT `booking_charges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_stops` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`booking_id` bigint unsigned NOT NULL,
	`seq` int NOT NULL,
	`stop_type` enum('pickup','drop','via') NOT NULL,
	`location_id` bigint unsigned,
	`name` varchar(140) NOT NULL,
	`address_line` varchar(255),
	`city` varchar(80) NOT NULL,
	`state` varchar(80),
	`pincode` varchar(10),
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`contact_name` varchar(120),
	`contact_phone` varchar(32),
	`window_start` datetime(3),
	`window_end` datetime(3),
	`instructions` varchar(255),
	CONSTRAINT `booking_stops_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_booking_stops_seq` UNIQUE(`booking_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`booking_no` varchar(24) NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`customer_ref` varchar(60),
	`status` enum('draft','quoted','approved','planned','in_transit','delivered','invoiced','closed','on_hold','cancelled') NOT NULL DEFAULT 'draft',
	`hold_from_status` enum('draft','quoted','approved','planned','in_transit','delivered','invoiced','closed','on_hold','cancelled'),
	`lr_number` varchar(24),
	`eway_bill_no` varchar(20),
	`eway_bill_expires_at` datetime(3),
	`route_id` bigint unsigned,
	`origin_city` varchar(80) NOT NULL,
	`destination_city` varchar(80) NOT NULL,
	`required_vehicle_type_id` bigint unsigned,
	`required_body_type` enum('open','closed','container','reefer','tanker','flatbed','tipper','trailer','other'),
	`requires_temperature_control` boolean NOT NULL DEFAULT false,
	`is_hazardous` boolean NOT NULL DEFAULT false,
	`total_weight_kg` decimal(12,3) NOT NULL DEFAULT '0.000',
	`total_volume_cbm` decimal(10,2),
	`loading_window_start` datetime(3) NOT NULL,
	`loading_window_end` datetime(3),
	`delivery_deadline` datetime(3) NOT NULL,
	`rate_basis` enum('per_trip','per_tonne','per_km'),
	`rate` decimal(12,2),
	`quoted_amount` decimal(14,2),
	`approved_amount` decimal(14,2),
	`payment_terms_days` int,
	`special_instructions` text,
	`notes` text,
	`quoted_at` datetime(3),
	`quoted_by` bigint unsigned,
	`approved_at` datetime(3),
	`approved_by` bigint unsigned,
	`cancelled_at` datetime(3),
	`cancel_reason` varchar(255),
	`hold_reason` varchar(255),
	`created_by` bigint unsigned,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bookings_org_no` UNIQUE(`org_id`,`booking_no`),
	CONSTRAINT `uq_bookings_org_lr` UNIQUE(`org_id`,`lr_number`)
);
--> statement-breakpoint
CREATE TABLE `cargo_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`booking_id` bigint unsigned NOT NULL,
	`description` varchar(200) NOT NULL,
	`category` enum('general','fragile','perishable','hazardous','high_value','oversized','liquid_bulk','other') NOT NULL DEFAULT 'general',
	`hsn_code` varchar(10),
	`quantity` decimal(12,3) NOT NULL,
	`unit` varchar(16) NOT NULL,
	`weight_kg` decimal(12,3) NOT NULL,
	`volume_cbm` decimal(10,2),
	`packaging` varchar(40),
	`declared_value` decimal(14,2),
	`handling` varchar(255),
	CONSTRAINT `cargo_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cargo_seals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`seal_no` varchar(40) NOT NULL,
	`applied_at` datetime(3) NOT NULL,
	`applied_by` bigint unsigned,
	`verified_at` datetime(3),
	`verified_by` bigint unsigned,
	`intact` boolean,
	`notes` varchar(255),
	CONSTRAINT `cargo_seals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cargo_seals_org_no` UNIQUE(`org_id`,`seal_no`)
);
--> statement-breakpoint
CREATE TABLE `inspection_templates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`inspection_type` enum('pre_trip','post_trip') NOT NULL,
	`items` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `inspection_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inspections` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`vehicle_id` bigint unsigned NOT NULL,
	`inspection_type` enum('pre_trip','post_trip') NOT NULL,
	`template_id` bigint unsigned,
	`inspected_by` bigint unsigned,
	`inspected_at` datetime(3) NOT NULL,
	`odometer` decimal(12,1),
	`result` enum('pass','fail') NOT NULL,
	`items` json NOT NULL,
	`notes` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `inspections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proof_of_delivery` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`method` enum('otp','override') NOT NULL,
	`recipient_name` varchar(120) NOT NULL,
	`recipient_phone` varchar(32),
	`delivered_at` datetime(3) NOT NULL,
	`override_reason` varchar(255),
	`damage_reported` boolean NOT NULL DEFAULT false,
	`shortage_reported` boolean NOT NULL DEFAULT false,
	`remarks` varchar(500),
	`signature_file_id` bigint unsigned,
	`photo_file_ids` json,
	`recorded_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `proof_of_delivery_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pod_trip` UNIQUE(`trip_id`)
);
--> statement-breakpoint
CREATE TABLE `resource_reservations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`resource_type` enum('vehicle','worker') NOT NULL,
	`resource_id` bigint unsigned NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `resource_reservations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trip_crew` (
	`trip_id` bigint unsigned NOT NULL,
	`worker_id` bigint unsigned NOT NULL,
	`role` enum('co_driver','helper') NOT NULL,
	CONSTRAINT `trip_crew_trip_id_worker_id_pk` PRIMARY KEY(`trip_id`,`worker_id`)
);
--> statement-breakpoint
CREATE TABLE `trip_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`event_type` enum('created','assigned','reassigned','inspection_passed','inspection_failed','dispatched','loading_started','loading_completed','checkpoint','arrived_stop','departed_stop','unloading_started','unloading_completed','delay_reported','otp_issued','otp_failed','delivered','completed','on_hold','resumed','cancelled','reconciled','closed','note') NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`stop_id` bigint unsigned,
	`note` varchar(500),
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`odometer` decimal(12,1),
	`recorded_by` bigint unsigned,
	`source` enum('web','driver_app','system','simulated') NOT NULL DEFAULT 'web',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `trip_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trip_status_history` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`from_status` enum('planned','ready','in_transit','delivered','completed','reconciled','closed','on_hold','cancelled'),
	`to_status` enum('planned','ready','in_transit','delivered','completed','reconciled','closed','on_hold','cancelled') NOT NULL,
	`changed_by` bigint unsigned,
	`reason` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `trip_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trip_stops` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`seq` int NOT NULL,
	`stop_type` enum('pickup','drop','via') NOT NULL,
	`booking_stop_id` bigint unsigned,
	`name` varchar(140) NOT NULL,
	`address_line` varchar(255),
	`city` varchar(80) NOT NULL,
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`contact_name` varchar(120),
	`contact_phone` varchar(32),
	`planned_arrival` datetime(3),
	`actual_arrival` datetime(3),
	`actual_departure` datetime(3),
	`status` enum('pending','arrived','departed','skipped') NOT NULL DEFAULT 'pending',
	CONSTRAINT `trip_stops_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_trip_stops_seq` UNIQUE(`trip_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`org_id` bigint unsigned NOT NULL,
	`trip_no` varchar(24) NOT NULL,
	`booking_id` bigint unsigned,
	`trip_type` enum('loaded','empty','return') NOT NULL DEFAULT 'loaded',
	`parent_trip_id` bigint unsigned,
	`status` enum('planned','ready','in_transit','delivered','completed','reconciled','closed','on_hold','cancelled') NOT NULL DEFAULT 'planned',
	`hold_from_status` enum('planned','ready','in_transit','delivered','completed','reconciled','closed','on_hold','cancelled'),
	`hold_reason` varchar(255),
	`vehicle_id` bigint unsigned NOT NULL,
	`driver_id` bigint unsigned NOT NULL,
	`route_id` bigint unsigned,
	`origin_city` varchar(80) NOT NULL,
	`destination_city` varchar(80) NOT NULL,
	`planned_start` datetime(3) NOT NULL,
	`planned_end` datetime(3) NOT NULL,
	`actual_start` datetime(3),
	`delivered_at` datetime(3),
	`completed_at` datetime(3),
	`start_odometer` decimal(12,1),
	`end_odometer` decimal(12,1),
	`planned_distance_km` decimal(8,1),
	`delivery_otp_hash` char(64),
	`delivery_otp_expires_at` datetime(3),
	`delivery_otp_attempts` int NOT NULL DEFAULT 0,
	`pod_status` enum('pending','verified_otp','override','not_required') NOT NULL DEFAULT 'pending',
	`override_reason` varchar(255),
	`overridden_by` bigint unsigned,
	`cancel_reason` varchar(255),
	`notes` text,
	`created_by` bigint unsigned,
	`reconciled_at` datetime(3),
	`closed_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `trips_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_trips_org_no` UNIQUE(`org_id`,`trip_no`)
);
--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_recorded_by_users_id_fk` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `compensation_policies` ADD CONSTRAINT `compensation_policies_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_licence_classes` ADD CONSTRAINT `driver_licence_classes_licence_id_driver_licences_id_fk` FOREIGN KEY (`licence_id`) REFERENCES `driver_licences`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_licences` ADD CONSTRAINT `driver_licences_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_licences` ADD CONSTRAINT `driver_licences_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_licences` ADD CONSTRAINT `driver_licences_verified_by_users_id_fk` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `driver_licences` ADD CONSTRAINT `driver_licences_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `duty_rosters` ADD CONSTRAINT `duty_rosters_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `duty_rosters` ADD CONSTRAINT `duty_rosters_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_decided_by_users_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_documents` ADD CONSTRAINT `worker_documents_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_documents` ADD CONSTRAINT `worker_documents_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_documents` ADD CONSTRAINT `worker_documents_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_trainings` ADD CONSTRAINT `worker_trainings_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_trainings` ADD CONSTRAINT `worker_trainings_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workers` ADD CONSTRAINT `workers_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workers` ADD CONSTRAINT `workers_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workers` ADD CONSTRAINT `workers_compensation_policy_id_compensation_policies_id_fk` FOREIGN KEY (`compensation_policy_id`) REFERENCES `compensation_policies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_contacts` ADD CONSTRAINT `customer_contacts_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_contacts` ADD CONSTRAINT `customer_contacts_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_rate_cards` ADD CONSTRAINT `customer_rate_cards_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_rate_cards` ADD CONSTRAINT `customer_rate_cards_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_rate_cards` ADD CONSTRAINT `customer_rate_cards_vehicle_type_id_vehicle_types_id_fk` FOREIGN KEY (`vehicle_type_id`) REFERENCES `vehicle_types`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `locations` ADD CONSTRAINT `locations_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `locations` ADD CONSTRAINT `locations_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routes` ADD CONSTRAINT `routes_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendors` ADD CONSTRAINT `vendors_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_charges` ADD CONSTRAINT `booking_charges_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_charges` ADD CONSTRAINT `booking_charges_booking_id_bookings_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_stops` ADD CONSTRAINT `booking_stops_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_stops` ADD CONSTRAINT `booking_stops_booking_id_bookings_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_stops` ADD CONSTRAINT `booking_stops_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_route_id_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_required_vehicle_type_id_vehicle_types_id_fk` FOREIGN KEY (`required_vehicle_type_id`) REFERENCES `vehicle_types`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_quoted_by_users_id_fk` FOREIGN KEY (`quoted_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cargo_items` ADD CONSTRAINT `cargo_items_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cargo_items` ADD CONSTRAINT `cargo_items_booking_id_bookings_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cargo_seals` ADD CONSTRAINT `cargo_seals_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cargo_seals` ADD CONSTRAINT `cargo_seals_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cargo_seals` ADD CONSTRAINT `cargo_seals_applied_by_users_id_fk` FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cargo_seals` ADD CONSTRAINT `cargo_seals_verified_by_users_id_fk` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspection_templates` ADD CONSTRAINT `inspection_templates_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_template_id_inspection_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `inspection_templates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_inspected_by_users_id_fk` FOREIGN KEY (`inspected_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `proof_of_delivery` ADD CONSTRAINT `proof_of_delivery_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `proof_of_delivery` ADD CONSTRAINT `proof_of_delivery_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `proof_of_delivery` ADD CONSTRAINT `proof_of_delivery_signature_file_id_files_id_fk` FOREIGN KEY (`signature_file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `proof_of_delivery` ADD CONSTRAINT `proof_of_delivery_recorded_by_users_id_fk` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resource_reservations` ADD CONSTRAINT `resource_reservations_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resource_reservations` ADD CONSTRAINT `resource_reservations_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_crew` ADD CONSTRAINT `trip_crew_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_crew` ADD CONSTRAINT `trip_crew_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_events` ADD CONSTRAINT `trip_events_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_events` ADD CONSTRAINT `trip_events_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_events` ADD CONSTRAINT `trip_events_stop_id_trip_stops_id_fk` FOREIGN KEY (`stop_id`) REFERENCES `trip_stops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_events` ADD CONSTRAINT `trip_events_recorded_by_users_id_fk` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_status_history` ADD CONSTRAINT `trip_status_history_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_status_history` ADD CONSTRAINT `trip_status_history_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_status_history` ADD CONSTRAINT `trip_status_history_changed_by_users_id_fk` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_stops` ADD CONSTRAINT `trip_stops_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_stops` ADD CONSTRAINT `trip_stops_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_stops` ADD CONSTRAINT `trip_stops_booking_stop_id_booking_stops_id_fk` FOREIGN KEY (`booking_stop_id`) REFERENCES `booking_stops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_booking_id_bookings_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_vehicle_id_vehicles_id_fk` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_driver_id_workers_id_fk` FOREIGN KEY (`driver_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_route_id_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_overridden_by_users_id_fk` FOREIGN KEY (`overridden_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_attendance_org_date` ON `attendance` (`org_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `ix_driver_licences_worker` ON `driver_licences` (`worker_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `ix_driver_licences_expiry` ON `driver_licences` (`org_id`,`valid_until`);--> statement-breakpoint
CREATE INDEX `ix_rosters_worker_time` ON `duty_rosters` (`worker_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `ix_leave_worker_dates` ON `leave_requests` (`worker_id`,`status`,`from_date`,`to_date`);--> statement-breakpoint
CREATE INDEX `ix_worker_docs_worker` ON `worker_documents` (`worker_id`);--> statement-breakpoint
CREATE INDEX `ix_worker_trainings_worker` ON `worker_trainings` (`worker_id`,`training_type`);--> statement-breakpoint
CREATE INDEX `ix_workers_org_type_status` ON `workers` (`org_id`,`worker_type`,`employment_status`);--> statement-breakpoint
CREATE INDEX `ix_customer_contacts_customer` ON `customer_contacts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_rate_cards_lookup` ON `customer_rate_cards` (`org_id`,`customer_id`,`origin_city`,`destination_city`);--> statement-breakpoint
CREATE INDEX `ix_customers_org_name` ON `customers` (`org_id`,`name`);--> statement-breakpoint
CREATE INDEX `ix_locations_org_city` ON `locations` (`org_id`,`city`);--> statement-breakpoint
CREATE INDEX `ix_locations_customer` ON `locations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_routes_cities` ON `routes` (`org_id`,`origin_city`,`destination_city`);--> statement-breakpoint
CREATE INDEX `ix_vendors_org_type` ON `vendors` (`org_id`,`vendor_type`);--> statement-breakpoint
CREATE INDEX `ix_charges_booking` ON `booking_charges` (`booking_id`);--> statement-breakpoint
CREATE INDEX `ix_bookings_org_status` ON `bookings` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_bookings_customer` ON `bookings` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_bookings_loading` ON `bookings` (`org_id`,`loading_window_start`);--> statement-breakpoint
CREATE INDEX `ix_cargo_booking` ON `cargo_items` (`booking_id`);--> statement-breakpoint
CREATE INDEX `ix_cargo_seals_trip` ON `cargo_seals` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_inspection_templates_org` ON `inspection_templates` (`org_id`,`inspection_type`,`is_active`);--> statement-breakpoint
CREATE INDEX `ix_inspections_trip` ON `inspections` (`trip_id`,`inspection_type`);--> statement-breakpoint
CREATE INDEX `ix_reservations_lookup` ON `resource_reservations` (`resource_type`,`resource_id`,`active`,`starts_at`);--> statement-breakpoint
CREATE INDEX `ix_reservations_trip` ON `resource_reservations` (`trip_id`);--> statement-breakpoint
CREATE INDEX `ix_trip_events_trip` ON `trip_events` (`trip_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_trip_history_trip` ON `trip_status_history` (`trip_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_trips_org_status` ON `trips` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_trips_vehicle` ON `trips` (`vehicle_id`,`planned_start`);--> statement-breakpoint
CREATE INDEX `ix_trips_driver` ON `trips` (`driver_id`,`planned_start`);--> statement-breakpoint
CREATE INDEX `ix_trips_booking` ON `trips` (`booking_id`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_worker_id_workers_id_fk` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_vendor_id_vendors_id_fk` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE no action ON UPDATE no action;