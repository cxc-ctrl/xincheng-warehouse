ALTER TABLE orders ADD shipped_at integer;
ALTER TABLE orders ADD source_updated_at integer;
ALTER TABLE orders ADD shipped_qty integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD unit_cost_snapshot real;
ALTER TABLE orders ADD cutoff_ack_at integer;
ALTER TABLE movements ADD effective_at integer;
CREATE TABLE order_conflicts (
 scope text NOT NULL, order_key text NOT NULL, payload text NOT NULL,
 reason text NOT NULL, fingerprint text NOT NULL, created_at integer NOT NULL,
 PRIMARY KEY(scope,order_key)
);
CREATE TABLE order_returns (
 scope text NOT NULL, id text NOT NULL, order_key text NOT NULL,
 code text NOT NULL, kind text NOT NULL, quantity integer NOT NULL,
 at integer NOT NULL, PRIMARY KEY(scope,id)
);
CREATE INDEX returns_by_order ON order_returns(scope,order_key,kind,code);
-- Preserve recorded shipments even when the latest ERP status is cancelled/refunded.
UPDATE orders SET shipped_qty=MAX(deducted_qty,CASE WHEN status IN ('已发货','已完成') THEN quantity ELSE 0 END,
 COALESCE((SELECT MAX(CAST(os.deducted_qty/r.per_unit AS INTEGER)) FROM order_stocks os JOIN stock_rules r ON r.scope=os.scope AND r.sales_code=os.sales_code AND r.stock_code=os.stock_code WHERE os.scope=orders.scope AND os.order_key=orders.key),0));
DROP TRIGGER physical_order_insert;
DROP TRIGGER physical_order_update;
CREATE TRIGGER physical_order_insert AFTER INSERT ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,NEW.shipped_qty*r.per_unit,0,NEW.updated_at
 FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.quantity IS NOT NULL
 AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at>=COALESCE(p.tracking_at,0)
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
CREATE TRIGGER physical_order_update AFTER UPDATE ON orders
WHEN NEW.reset=0 AND NEW.shipped_qty>0
BEGIN
 INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at)
 SELECT NEW.scope,NEW.key,NEW.code,r.stock_code,NEW.shipped_qty*r.per_unit,0,NEW.updated_at
 FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code
 JOIN products p ON p.scope=r.scope AND p.code=r.sales_code
 WHERE r.scope=NEW.scope AND r.sales_code=NEW.code AND p.stock_mode='recipe' AND p.tracking_enabled=1
 AND s.archived=0 AND p.recipe_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.quantity IS NOT NULL
 AND s.count_at<=COALESCE(NEW.shipped_at,NEW.order_time) AND s.count_at>=COALESCE(p.tracking_at,0)
 ON CONFLICT(scope,order_key,stock_code) DO UPDATE SET deducted_qty=MAX(order_stocks.deducted_qty,excluded.deducted_qty),reset=0,updated_at=excluded.updated_at;
END;
