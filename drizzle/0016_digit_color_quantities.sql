ALTER TABLE digit_fulfillment_rules ADD allocated_qty integer;
DROP TRIGGER physical_order_insert;
DROP TRIGGER physical_order_update;
DROP VIEW order_effective_rules;
CREATE VIEW order_effective_rules AS
 SELECT o.scope,o.key AS order_key,r.sales_code,r.stock_code,r.per_unit,0 AS ignore_cutoff,NULL AS allocated_qty FROM orders o JOIN stock_rules r ON r.scope=o.scope AND r.sales_code=o.code WHERE NOT EXISTS(SELECT 1 FROM digit_fulfillments f WHERE f.scope=o.scope AND f.order_key=o.key)
 UNION ALL
 SELECT r.scope,r.order_key,r.sales_code,r.stock_code,r.per_unit,f.ignore_cutoff,r.allocated_qty FROM digit_fulfillment_rules r JOIN digit_fulfillments f ON f.scope=r.scope AND f.order_key=r.order_key WHERE f.status IN ('auto','manual');


CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1)
 OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
CREATE TRIGGER physical_order_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1)
 OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
