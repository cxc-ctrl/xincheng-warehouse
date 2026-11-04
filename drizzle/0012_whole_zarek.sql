CREATE TABLE `cost_materials` (
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`gsm` real NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `id`)
);
--> statement-breakpoint
CREATE TABLE `freight_templates` (
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_weights` (
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `kind`, `code`)
);
