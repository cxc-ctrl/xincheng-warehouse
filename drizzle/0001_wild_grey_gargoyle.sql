CREATE TABLE `order_stocks` (
	`scope` text NOT NULL,
	`order_key` text NOT NULL,
	`sales_code` text NOT NULL,
	`stock_code` text NOT NULL,
	`deducted_qty` integer DEFAULT 0 NOT NULL,
	`reset` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `order_key`, `stock_code`)
);
--> statement-breakpoint
CREATE INDEX `deductions_by_stock` ON `order_stocks` (`scope`,`stock_code`);--> statement-breakpoint
CREATE TABLE `physical_stocks` (
	`scope` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`spec` text DEFAULT '' NOT NULL,
	`quantity` integer,
	`count_at` integer,
	`cost` real,
	`location` text DEFAULT '' NOT NULL,
	`minimum` integer DEFAULT 10 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `code`)
);
--> statement-breakpoint
CREATE TABLE `stock_rules` (
	`scope` text NOT NULL,
	`sales_code` text NOT NULL,
	`stock_code` text NOT NULL,
	`per_unit` integer NOT NULL,
	PRIMARY KEY(`scope`, `sales_code`, `stock_code`)
);
--> statement-breakpoint
CREATE INDEX `rules_by_stock` ON `stock_rules` (`scope`,`stock_code`);--> statement-breakpoint
ALTER TABLE `movements` ADD `kind` text DEFAULT 'product' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `stock_mode` text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `recipe_at` integer;
--> statement-breakpoint
DROP TRIGGER orders_stock_insert;
--> statement-breakpoint
DROP TRIGGER orders_stock_update;
--> statement-breakpoint
CREATE TRIGGER orders_stock_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty>0 AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct')
BEGIN
 UPDATE products SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-NEW.deducted_qty,NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER orders_stock_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct')
BEGIN
 UPDATE products SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-(NEW.deducted_qty-OLD.deducted_qty),NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.status IN ('已发货','已完成')
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,NEW.quantity*r.per_unit,0,NEW.updated_at
 FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe'
 AND p.recipe_at<=NEW.order_time AND s.quantity IS NOT NULL AND s.count_at<=NEW.order_time
 AND NOT EXISTS(SELECT 1 FROM stock_rules r2 LEFT JOIN physical_stocks s2 ON s2.scope=r2.scope AND s2.code=r2.stock_code WHERE r2.scope=r.scope AND r2.sales_code=r.sales_code AND s2.quantity IS NULL)
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER physical_order_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.status IN ('已发货','已完成')
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,NEW.quantity*r.per_unit,0,NEW.updated_at
 FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe'
 AND p.recipe_at<=NEW.order_time AND s.quantity IS NOT NULL AND s.count_at<=NEW.order_time
 AND NOT EXISTS(SELECT 1 FROM stock_rules r2 LEFT JOIN physical_stocks s2 ON s2.scope=r2.scope AND s2.code=r2.stock_code WHERE r2.scope=r.scope AND r2.sales_code=r.sales_code AND s2.quantity IS NULL)
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER physical_stock_insert AFTER INSERT ON order_stocks
WHEN NEW.reset=0 AND NEW.deducted_qty>0
BEGIN
 UPDATE physical_stocks SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.stock_code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.stock_code,'physical','纸张订单扣减',-NEW.deducted_qty,'销售编码 '||NEW.sales_code||' · 订单 '||COALESCE((SELECT order_id FROM orders WHERE scope=NEW.scope AND key=NEW.order_key),NEW.order_key),NEW.updated_at,NEW.order_key);
END;
--> statement-breakpoint
CREATE TRIGGER physical_stock_update AFTER UPDATE ON order_stocks
WHEN NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty
BEGIN
 UPDATE physical_stocks SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.stock_code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.stock_code,'physical','纸张订单扣减',-(NEW.deducted_qty-OLD.deducted_qty),'销售编码 '||NEW.sales_code||' · 订单 '||COALESCE((SELECT order_id FROM orders WHERE scope=NEW.scope AND key=NEW.order_key),NEW.order_key),NEW.updated_at,NEW.order_key);
END;
--> statement-breakpoint
CREATE TRIGGER protect_processed_rules_delete BEFORE DELETE ON stock_rules
WHEN EXISTS(SELECT 1 FROM order_stocks WHERE scope=OLD.scope AND sales_code=OLD.sales_code AND deducted_qty>0)
BEGIN SELECT RAISE(ABORT,'此规则已产生纸张扣减，请先核对库存后再更换规则'); END;
--> statement-breakpoint
CREATE TRIGGER protect_processed_products BEFORE UPDATE OF stock_mode,recipe_at ON products
WHEN (NEW.stock_mode!=OLD.stock_mode OR COALESCE(NEW.recipe_at,0)!=COALESCE(OLD.recipe_at,0))
 AND (EXISTS(SELECT 1 FROM orders WHERE scope=OLD.scope AND code=OLD.code AND deducted_qty>0) OR EXISTS(SELECT 1 FROM order_stocks WHERE scope=OLD.scope AND sales_code=OLD.code AND deducted_qty>0))
BEGIN SELECT RAISE(ABORT,'此商品已产生扣减，无法直接更换库存方式'); END;
