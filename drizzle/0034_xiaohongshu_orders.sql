ALTER TABLE orders ADD COLUMN source_details TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS orders_scope_order_id ON orders(scope,order_id);
CREATE TABLE order_source_shops (
 scope TEXT NOT NULL, source TEXT NOT NULL, source_shop TEXT NOT NULL,
 platform TEXT NOT NULL, shop TEXT NOT NULL,
 PRIMARY KEY(scope,source,source_shop)
);
