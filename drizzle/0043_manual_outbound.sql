CREATE TABLE manual_outbound_links (
 scope TEXT NOT NULL, order_key TEXT NOT NULL, entry_id TEXT NOT NULL,
 platform TEXT NOT NULL, shop TEXT NOT NULL, order_id TEXT NOT NULL, sales_code TEXT NOT NULL,
 quantity INTEGER NOT NULL, unit_cost REAL, fulfilled_at INTEGER NOT NULL, items TEXT NOT NULL,
 PRIMARY KEY(scope,order_key)
);
CREATE INDEX manual_outbound_identity ON manual_outbound_links(scope,order_id,sales_code);
CREATE UNIQUE INDEX manual_outbound_entry ON manual_outbound_links(scope,entry_id);
CREATE VIEW manual_outbound_parts AS
 SELECT l.scope,l.order_key,l.sales_code,json_extract(i.value,'$.code') AS stock_code,
 json_extract(i.value,'$.quantity') AS quantity,l.quantity AS allocated_qty
 FROM manual_outbound_links l,json_each(l.items) i WHERE json_extract(i.value,'$.kind')='physical';
DROP VIEW order_effective_rules;
CREATE VIEW order_effective_rules AS
 SELECT o.scope,o.key AS order_key,r.sales_code,r.stock_code,r.per_unit,0 AS ignore_cutoff,NULL AS allocated_qty
 FROM orders o JOIN stock_rules r ON r.scope=o.scope AND r.sales_code=o.code
 WHERE NOT EXISTS(SELECT 1 FROM digit_fulfillments f WHERE f.scope=o.scope AND f.order_key=o.key)
 AND NOT EXISTS(SELECT 1 FROM manual_outbound_links m WHERE m.scope=o.scope AND m.order_key=o.key)
 UNION ALL
 SELECT r.scope,r.order_key,r.sales_code,r.stock_code,r.per_unit,f.ignore_cutoff,r.allocated_qty
 FROM digit_fulfillment_rules r JOIN digit_fulfillments f ON f.scope=r.scope AND f.order_key=r.order_key
 WHERE f.status IN ('auto','manual') AND NOT EXISTS(SELECT 1 FROM manual_outbound_links m WHERE m.scope=r.scope AND m.order_key=r.order_key)
 UNION ALL
 SELECT scope,order_key,sales_code,stock_code,1.0*quantity/allocated_qty,0,allocated_qty FROM manual_outbound_parts;
DROP TRIGGER orders_stock_insert;
DROP TRIGGER orders_stock_update;
DROP TRIGGER physical_order_insert;
DROP TRIGGER physical_order_update;
CREATE TRIGGER orders_stock_insert AFTER INSERT ON orders
WHEN NOT EXISTS(SELECT 1 FROM manual_outbound_links m WHERE m.scope=NEW.scope AND m.order_key=NEW.key) AND NEW.reset=0 AND NEW.deducted_qty>0
 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
 AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0))
BEGIN
 UPDATE products SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-NEW.deducted_qty,NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
CREATE TRIGGER orders_stock_update AFTER UPDATE ON orders
WHEN NOT EXISTS(SELECT 1 FROM manual_outbound_links m WHERE m.scope=NEW.scope AND m.order_key=NEW.key) AND NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty
 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
 AND EXISTS(SELECT 1 FROM products WHERE scope=NEW.scope AND code=NEW.code AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0))
BEGIN
 UPDATE products SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,type,delta,note,at,reference) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.code,'订单扣减',-(NEW.deducted_qty-OLD.deducted_qty),NEW.shop||' · 订单 '||NEW.order_id,NEW.updated_at,NEW.key);
END;
CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NOT EXISTS(SELECT 1 FROM manual_outbound_links m WHERE m.scope=NEW.scope AND m.order_key=NEW.key) AND NEW.reset=0 AND NEW.shipped_qty>0 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1 AND COALESCE((SELECT import_test_mode FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
CREATE TRIGGER physical_order_update AFTER UPDATE ON orders
WHEN NOT EXISTS(SELECT 1 FROM manual_outbound_links m WHERE m.scope=NEW.scope AND m.order_key=NEW.key) AND NEW.reset=0 AND NEW.shipped_qty>0 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=NEW.scope AND j.shop=NEW.shop AND j.order_id=NEW.order_id)
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,COALESCE(r.allocated_qty,NEW.shipped_qty)*r.per_unit,0,NEW.updated_at
 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND r.order_key=NEW.key AND p.stock_mode='recipe' AND p.tracking_enabled=1 AND s.archived=0 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)
 AND ((r.ignore_cutoff=1 AND COALESCE((SELECT import_test_mode FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (NEW.status IN ('已发货','已完成') AND COALESCE((SELECT active_test_import FROM warehouse_settings WHERE scope=NEW.scope),0)=1) OR (p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at<COALESCE(NEW.shipped_at,NEW.order_time)))
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;


