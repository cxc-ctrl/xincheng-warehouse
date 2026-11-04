CREATE TABLE IF NOT EXISTS product_supply_profiles (
 scope text NOT NULL,code text NOT NULL,source_product text NOT NULL,source_revision integer NOT NULL,
 config text NOT NULL,updated_at integer NOT NULL,PRIMARY KEY(scope,code)
);
