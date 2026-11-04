CREATE TABLE IF NOT EXISTS stock_alert_settings(scope TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS stock_alert_ignores(scope TEXT NOT NULL,kind TEXT NOT NULL,code TEXT NOT NULL,until_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(scope,kind,code));
CREATE TABLE IF NOT EXISTS stock_alert_sample(scope TEXT PRIMARY KEY,filename TEXT NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL,orders_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
