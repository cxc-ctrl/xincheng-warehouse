CREATE TABLE purchase_orders (
 scope TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('physical','product')),
 code TEXT NOT NULL, name TEXT NOT NULL, spec TEXT NOT NULL, unit TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 supplier TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','received','cancelled')),
 created_at INTEGER NOT NULL, received_at INTEGER, updated_at INTEGER NOT NULL,
 PRIMARY KEY(scope,id)
);
CREATE INDEX purchases_by_date ON purchase_orders(scope,created_at);
CREATE TABLE purchase_defaults (
 scope TEXT NOT NULL, kind TEXT NOT NULL, code TEXT NOT NULL,
 supplier TEXT NOT NULL, unit TEXT NOT NULL, unit_price REAL NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(scope,kind,code)
);
