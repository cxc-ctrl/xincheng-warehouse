CREATE TABLE IF NOT EXISTS shop_configs(
 scope TEXT NOT NULL,id TEXT NOT NULL,platform TEXT NOT NULL DEFAULT '',code TEXT NOT NULL,name TEXT NOT NULL,team TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('own','supply')),enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),updated_at INTEGER NOT NULL,
 PRIMARY KEY(scope,id),UNIQUE(scope,platform,code));
CREATE TABLE IF NOT EXISTS shop_pricing_versions(
 scope TEXT NOT NULL,id TEXT NOT NULL,shop_id TEXT NOT NULL,effective_at INTEGER NOT NULL,config TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(scope,id),FOREIGN KEY(scope,shop_id) REFERENCES shop_configs(scope,id));
CREATE INDEX IF NOT EXISTS shop_pricing_effective ON shop_pricing_versions(scope,shop_id,effective_at,created_at);
CREATE TABLE IF NOT EXISTS shop_order_pricing(
 scope TEXT NOT NULL,platform TEXT NOT NULL,shop TEXT NOT NULL,order_id TEXT NOT NULL,version_id TEXT NOT NULL,basis_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(scope,platform,shop,order_id),FOREIGN KEY(scope,version_id) REFERENCES shop_pricing_versions(scope,id));
CREATE TABLE IF NOT EXISTS shop_held_orders(
 scope TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,filename TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','released')),shop_id TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL,
 PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS shop_settings(scope TEXT PRIMARY KEY,supplier_team TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS orders_shop_identity ON orders(scope,platform,shop,order_id);
