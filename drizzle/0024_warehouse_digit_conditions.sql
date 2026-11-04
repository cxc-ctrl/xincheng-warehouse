CREATE TABLE IF NOT EXISTS warehouse_digit_conditions (
 scope TEXT NOT NULL,color TEXT NOT NULL,size REAL NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,
 out_of_range TEXT NOT NULL,shortage TEXT NOT NULL,print_rule_id TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL,PRIMARY KEY(scope,color,size));
