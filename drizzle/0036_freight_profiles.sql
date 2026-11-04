ALTER TABLE freight_imports ADD COLUMN carrier_profile TEXT NOT NULL DEFAULT '';
ALTER TABLE freight_bills ADD COLUMN raw_fee TEXT NOT NULL DEFAULT '';
