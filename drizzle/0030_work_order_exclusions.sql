CREATE TABLE work_order_exclusions (
 scope TEXT NOT NULL,shop TEXT NOT NULL,order_id TEXT NOT NULL,platform TEXT NOT NULL,
 label TEXT NOT NULL DEFAULT '工单定制',snapshot TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(scope,shop,order_id)
);
