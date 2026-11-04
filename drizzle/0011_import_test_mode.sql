CREATE TABLE warehouse_settings (
 scope text PRIMARY KEY NOT NULL,
 import_test_mode integer NOT NULL DEFAULT 0,
 active_test_import integer NOT NULL DEFAULT 0,
 updated_at integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE batches ADD test_mode integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP TRIGGER physical_order_insert;
--> statement-breakpoint
DROP TRIGGER physical_order_update;
--> statement-breakpoint
CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,NEW.shipped_qty*r.per_unit,0,NEW.updated_at
 FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1)
 OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER physical_order_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,NEW.shipped_qty*r.per_unit,0,NEW.updated_at
 FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1)
 OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
