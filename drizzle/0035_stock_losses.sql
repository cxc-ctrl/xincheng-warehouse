CREATE TABLE stock_losses (
 scope TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,unit TEXT NOT NULL,
 loss_type TEXT NOT NULL,quantity INTEGER NOT NULL,unit_cost REAL,amount_cents INTEGER,before_qty INTEGER NOT NULL,after_qty INTEGER NOT NULL,
 reason TEXT NOT NULL,operator TEXT NOT NULL,account TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 destroyed_at INTEGER,voided_at INTEGER,PRIMARY KEY(scope,id)
);
CREATE INDEX stock_losses_date ON stock_losses(scope,created_at);
CREATE TABLE stock_loss_events (
 scope TEXT NOT NULL,id TEXT NOT NULL,loss_id TEXT NOT NULL,event TEXT NOT NULL,note TEXT NOT NULL,operator TEXT NOT NULL,account TEXT NOT NULL,
 at INTEGER NOT NULL,amount_cents INTEGER,PRIMARY KEY(scope,id)
);
CREATE INDEX stock_loss_events_date ON stock_loss_events(scope,at);
