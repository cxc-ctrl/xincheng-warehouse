CREATE TABLE order_finance (
 scope text NOT NULL, order_key text NOT NULL, refund_amount real, net_amount real,
 updated_at integer NOT NULL, PRIMARY KEY(scope,order_key)
);
CREATE TABLE order_waybills (
 scope text NOT NULL, order_key text NOT NULL, tracking text NOT NULL, carrier text NOT NULL DEFAULT '',
 PRIMARY KEY(scope,order_key,tracking)
);
CREATE INDEX waybills_by_tracking ON order_waybills(scope,tracking);
CREATE TABLE freight_bills (
 scope text NOT NULL, tracking text NOT NULL, month text NOT NULL, carrier text NOT NULL DEFAULT '',
 fee_cents integer NOT NULL, filename text NOT NULL, batch_id text NOT NULL, updated_at integer NOT NULL,
 PRIMARY KEY(scope,tracking)
);
CREATE INDEX freight_by_month ON freight_bills(scope,month);
CREATE TABLE freight_periods (
 scope text NOT NULL, month text NOT NULL, packing_cents integer,
 updated_at integer NOT NULL, PRIMARY KEY(scope,month)
);
CREATE TABLE freight_imports (
 scope text NOT NULL, id text NOT NULL, month text NOT NULL, filename text NOT NULL,
 total integer NOT NULL, skipped integer NOT NULL, processed integer NOT NULL DEFAULT 0,
 complete integer NOT NULL DEFAULT 0, created_at integer NOT NULL,
 PRIMARY KEY(scope,id)
);
