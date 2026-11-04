CREATE TABLE `analytics_settings` (
	`scope` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_lifecycle` (
	`scope` text NOT NULL,
	`code` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `code`)
);
