CREATE TABLE IF NOT EXISTS import_ignore_rules(
 scope TEXT NOT NULL,id TEXT NOT NULL,pattern TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN('exact','prefix')),
 note TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(scope,id),UNIQUE(scope,pattern,mode)
);
INSERT OR IGNORE INTO import_ignore_rules(scope,id,pattern,mode,note,enabled,created_at,updated_at)
 SELECT scope,'scent-card-test','XLXH-HM-XK','prefix','香卡测试商品暂不纳入仓库',1,0,0
 FROM (SELECT scope FROM orders UNION SELECT scope FROM products UNION SELECT 'local_seedy' scope);
