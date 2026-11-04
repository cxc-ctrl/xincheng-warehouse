CREATE TABLE print_catalog (
 scope text NOT NULL, code text NOT NULL, name text NOT NULL, spec text NOT NULL DEFAULT '',
 material text NOT NULL DEFAULT '', unit text NOT NULL DEFAULT '份', note text NOT NULL DEFAULT '',
 enabled integer NOT NULL DEFAULT 1, updated_at integer NOT NULL, PRIMARY KEY(scope,code)
);
CREATE TABLE print_jobs (
 scope text NOT NULL, shop text NOT NULL, order_id text NOT NULL, note text NOT NULL,
 status text NOT NULL DEFAULT 'queued', actual_quantity integer, unit text NOT NULL DEFAULT '张',
 cost_cents integer, completed_at integer, basis text NOT NULL, needs_review integer NOT NULL DEFAULT 0,
 created_at integer NOT NULL, updated_at integer NOT NULL, PRIMARY KEY(scope,shop,order_id)
);
CREATE TABLE print_events (
 scope text NOT NULL, id text NOT NULL, shop text NOT NULL, order_id text NOT NULL,
 action text NOT NULL, note text NOT NULL, at integer NOT NULL, PRIMARY KEY(scope,id)
);
CREATE TABLE print_stock_corrections (
 scope text NOT NULL, id text NOT NULL, kind text NOT NULL, code text NOT NULL,
 quantity integer NOT NULL, shipment_at integer NOT NULL, returned_at integer NOT NULL,
 shop text NOT NULL, order_id text NOT NULL, PRIMARY KEY(scope,id)
);
CREATE INDEX print_corrections_by_stock ON print_stock_corrections(scope,kind,code,shipment_at,returned_at);
CREATE TABLE packing_settings (
 scope text PRIMARY KEY NOT NULL, fee_cents integer, updated_at integer NOT NULL
);
INSERT INTO packing_settings(scope,fee_cents,updated_at)
SELECT p.scope,p.packing_cents,p.updated_at FROM freight_periods p
WHERE p.packing_cents IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM freight_periods n WHERE n.scope=p.scope AND n.packing_cents IS NOT NULL AND (n.updated_at>p.updated_at OR (n.updated_at=p.updated_at AND n.month>p.month))
);

-- Printing decisions survive every replay path, including recounts and ERP imports.
-- Guard the four stock mutation triggers directly rather than relying on trigger order.
DROP TRIGGER orders_stock_insert;
DROP TRIGGER orders_stock_update;
CREATE TRIGGER orders_stock_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty>0
 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
 AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0))
BEGIN
 UPDATE products SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-NEW.deducted_qty,NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
CREATE TRIGGER orders_stock_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty
 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
 AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0))
BEGIN
 UPDATE products SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-(NEW.deducted_qty-OLD.deducted_qty),NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
DROP TRIGGER physical_order_insert;
DROP TRIGGER physical_order_update;
CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
CREATE TRIGGER physical_order_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
DROP TRIGGER physical_stock_insert;
DROP TRIGGER physical_stock_update;
CREATE TRIGGER physical_stock_insert AFTER INSERT ON order_stocks
WHEN NEW.reset=0 AND NEW.deducted_qty>0 AND NOT EXISTS(SELECT 1 FROM orders o JOIN print_jobs j ON j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id WHERE o.scope=NEW.scope AND o.key=NEW.order_key)
BEGIN
 UPDATE physical_stocks SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.stock_code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.stock_code,'physical',CASE WHEN COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张')='张' THEN '纸张订单扣减' ELSE '实物订单扣减' END,-NEW.deducted_qty,'销售编码 '||NEW.sales_code||' · 订单 '||COALESCE((SELECT order_id FROM orders WHERE scope=NEW.scope AND key=NEW.order_key),NEW.order_key),NEW.updated_at,NEW.order_key,COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张'));
END;
CREATE TRIGGER physical_stock_update AFTER UPDATE ON order_stocks
WHEN NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty AND NOT EXISTS(SELECT 1 FROM orders o JOIN print_jobs j ON j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id WHERE o.scope=NEW.scope AND o.key=NEW.order_key)
BEGIN
 UPDATE physical_stocks SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.stock_code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.stock_code,'physical',CASE WHEN COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张')='张' THEN '纸张订单扣减' ELSE '实物订单扣减' END,-(NEW.deducted_qty-OLD.deducted_qty),'销售编码 '||NEW.sales_code||' · 订单 '||COALESCE((SELECT order_id FROM orders WHERE scope=NEW.scope AND key=NEW.order_key),NEW.order_key),NEW.updated_at,NEW.order_key,COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张'));
END;
CREATE TRIGGER print_direct_insert AFTER INSERT ON orders
WHEN NEW.deducted_qty>0 AND EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN UPDATE orders SET deducted_qty=0,reset=1 WHERE scope=NEW.scope AND key=NEW.key; END;
CREATE TRIGGER print_direct_update AFTER UPDATE OF deducted_qty ON orders
WHEN NEW.deducted_qty>0 AND EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN UPDATE orders SET deducted_qty=0,reset=1 WHERE scope=NEW.scope AND key=NEW.key; END;
CREATE TRIGGER print_physical_insert AFTER INSERT ON order_stocks
WHEN NEW.deducted_qty>0 AND EXISTS(SELECT 1 FROM orders o JOIN print_jobs j ON j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id WHERE o.scope=NEW.scope AND o.key=NEW.order_key)
BEGIN UPDATE order_stocks SET deducted_qty=0,reset=1 WHERE scope=NEW.scope AND order_key=NEW.order_key AND stock_code=NEW.stock_code; END;
CREATE TRIGGER print_physical_update AFTER UPDATE OF deducted_qty ON order_stocks
WHEN NEW.deducted_qty>0 AND EXISTS(SELECT 1 FROM orders o JOIN print_jobs j ON j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id WHERE o.scope=NEW.scope AND o.key=NEW.order_key)
BEGIN UPDATE order_stocks SET deducted_qty=0,reset=1 WHERE scope=NEW.scope AND order_key=NEW.order_key AND stock_code=NEW.stock_code; END;
