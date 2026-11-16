ALTER TABLE orders ADD COLUMN manual_stock_cost_cents INTEGER;
ALTER TABLE orders ADD COLUMN manual_stock_cost_basis TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN manual_stock_cost_note TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN manual_stock_cost_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN manual_stock_cost_operator TEXT NOT NULL DEFAULT '';
CREATE TABLE stock_cost_events (
 scope TEXT NOT NULL, id TEXT NOT NULL, order_key TEXT NOT NULL,
 previous_cents INTEGER, cost_cents INTEGER NOT NULL, basis TEXT NOT NULL,
 note TEXT NOT NULL, operator TEXT NOT NULL, at INTEGER NOT NULL,
 PRIMARY KEY(scope,id)
);
