ALTER TABLE `physical_stocks` ADD `unit` text DEFAULT '张' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `tracking_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `tracking_at` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `packing_cost` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP TRIGGER orders_stock_insert;
--> statement-breakpoint
DROP TRIGGER orders_stock_update;
--> statement-breakpoint
CREATE TRIGGER orders_stock_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty>0 AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0))
BEGIN
 UPDATE products SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-NEW.deducted_qty,NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER orders_stock_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0))
BEGIN
 UPDATE products SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-(NEW.deducted_qty-OLD.deducted_qty),NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
--> statement-breakpoint
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
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND p.recipe_at<=NEW.order_time AND s.quantity IS NOT NULL
 AND s.count_at<=NEW.order_time AND s.count_at>=COALESCE(p.tracking_at,0)
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
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND p.recipe_at<=NEW.order_time AND s.quantity IS NOT NULL
 AND s.count_at<=NEW.order_time AND s.count_at>=COALESCE(p.tracking_at,0)
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER protect_stock_unit BEFORE UPDATE OF unit ON physical_stocks
WHEN NEW.unit!=OLD.unit AND (OLD.quantity IS NOT NULL OR EXISTS(SELECT 1 FROM stock_rules WHERE scope=OLD.scope AND stock_code=OLD.code))
BEGIN SELECT RAISE(ABORT,'实物已盘点或关联，不能直接更换计数单位；请新建对应单位的实物并盘点'); END;
