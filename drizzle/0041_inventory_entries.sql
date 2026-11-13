CREATE TABLE inventory_entries (
 scope TEXT NOT NULL,id TEXT NOT NULL,type TEXT NOT NULL,order_key TEXT NOT NULL DEFAULT '',
 reference TEXT NOT NULL DEFAULT '',items TEXT NOT NULL,note TEXT NOT NULL,operator TEXT NOT NULL,
 received_at INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(scope,id)
);
CREATE INDEX inventory_entries_recent ON inventory_entries(scope,created_at);
ALTER TABLE order_returns ADD COLUMN damaged INTEGER NOT NULL DEFAULT 0;
