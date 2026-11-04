-- Count is a closing balance: shipments at/before the cutoff are included.
-- Legacy per-order test overrides cannot bypass a formal count.
DROP TRIGGER physical_order_insert;
DROP TRIGGER physical_order_update;
CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1 AND COALESCE((SELECT import_test_mode FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
CREATE TRIGGER physical_order_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1 AND COALESCE((SELECT import_test_mode FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
