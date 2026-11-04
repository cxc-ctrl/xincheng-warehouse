CREATE TABLE import_conflict_groups (
 scope TEXT NOT NULL,id TEXT NOT NULL,order_key TEXT NOT NULL,
 shop TEXT NOT NULL,order_id TEXT NOT NULL,code TEXT NOT NULL,
 filename TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 created_at INTEGER NOT NULL,resolved_at INTEGER,resolution TEXT NOT NULL DEFAULT '',old_order TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(scope,id)
);
CREATE UNIQUE INDEX one_pending_import_conflict ON import_conflict_groups(scope,order_key) WHERE status='pending';
