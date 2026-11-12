CREATE TABLE IF NOT EXISTS ignored_order_lines(
 scope TEXT NOT NULL,order_key TEXT NOT NULL,shop TEXT NOT NULL,order_id TEXT NOT NULL,
 code TEXT NOT NULL,payload TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(scope,order_key)
);
CREATE INDEX IF NOT EXISTS ignored_order_group ON ignored_order_lines(scope,shop,order_id);
