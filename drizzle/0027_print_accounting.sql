ALTER TABLE print_jobs ADD COLUMN accounting_mode TEXT NOT NULL DEFAULT 'whole';
ALTER TABLE print_jobs ADD COLUMN member_keys TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS orders_print_accounting_group ON orders(scope,shop,order_id,key);
CREATE INDEX IF NOT EXISTS orders_print_accounting_sku ON orders(scope,code);
