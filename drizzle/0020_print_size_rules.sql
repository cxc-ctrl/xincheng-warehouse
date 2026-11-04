CREATE TABLE IF NOT EXISTS print_size_rules (
 scope text NOT NULL,
 size_cm real NOT NULL CHECK(size_cm > 0 AND size_cm <= 200),
 per_sheet integer NOT NULL CHECK(per_sheet > 0 AND per_sheet <= 100000000),
 sheet_cost real CHECK(sheet_cost IS NULL OR sheet_cost >= 0),
 sheet_weight_g real CHECK(sheet_weight_g IS NULL OR sheet_weight_g > 0),
 enabled integer NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 updated_at integer NOT NULL,
 PRIMARY KEY(scope,size_cm)
);
