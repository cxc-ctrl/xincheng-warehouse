CREATE TABLE `batches` (
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`filename` text NOT NULL,
	`created_at` integer NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`valid` integer DEFAULT 0 NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scope`, `id`)
);
--> statement-breakpoint
CREATE TABLE `movements` (
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`delta` integer NOT NULL,
	`note` text NOT NULL,
	`at` integer NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`scope`, `id`)
);
--> statement-breakpoint
CREATE INDEX `movements_by_date` ON `movements` (`scope`,`at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`order_id` text NOT NULL,
	`shop` text NOT NULL,
	`platform` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`spec` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`order_time` integer NOT NULL,
	`amount` real,
	`cost` real,
	`deducted_qty` integer DEFAULT 0 NOT NULL,
	`review` integer DEFAULT 0 NOT NULL,
	`reset` integer DEFAULT 0 NOT NULL,
	`batch_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE INDEX `orders_by_product` ON `orders` (`scope`,`code`);--> statement-breakpoint
CREATE INDEX `orders_by_date` ON `orders` (`scope`,`order_time`);--> statement-breakpoint
CREATE TABLE `products` (
	`scope` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`spec` text DEFAULT '' NOT NULL,
	`pack` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '份' NOT NULL,
	`cost` real,
	`quantity` integer,
	`count_at` integer,
	`location` text DEFAULT '' NOT NULL,
	`minimum` integer DEFAULT 10 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '手动新增' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `code`)
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`scope`, `id`)
);

--> statement-breakpoint
-- Schema-only triggers: each order's recorded deduction drives an atomic stock delta.
CREATE TRIGGER orders_stock_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty>0
BEGIN
 UPDATE products SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-NEW.deducted_qty,NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER orders_stock_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty
BEGIN
 UPDATE products SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-(NEW.deducted_qty-OLD.deducted_qty),NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;

