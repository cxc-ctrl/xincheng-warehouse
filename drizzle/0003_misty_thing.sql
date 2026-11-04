ALTER TABLE `physical_stocks` ADD `archived` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `physical_stocks` ADD `ignore_warning` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `ignore_warning` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Each confirmed paper starts independently. Unknown paper quantities stay null.
DROP TRIGGER physical_order_insert;
--> statement-breakpoint
DROP TRIGGER physical_order_update;
--> statement-breakpoint
CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.status IN ('已发货','已完成')
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,NEW.quantity*r.per_unit,0,NEW.updated_at
 FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe'
 AND s.archived=0 AND p.recipe_at<=NEW.order_time AND s.quantity IS NOT NULL AND s.count_at<=NEW.order_time
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
 AND s.archived=0 AND p.recipe_at<=NEW.order_time AND s.quantity IS NOT NULL AND s.count_at<=NEW.order_time
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
