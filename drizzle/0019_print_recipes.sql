ALTER TABLE print_catalog ADD COLUMN per_pack integer;
ALTER TABLE print_catalog ADD COLUMN per_sheet integer;
ALTER TABLE print_catalog ADD COLUMN sheet_cost real;
ALTER TABLE print_catalog ADD COLUMN sheet_weight_g real;
ALTER TABLE print_catalog ADD COLUMN layout_mode text NOT NULL DEFAULT 'single';
ALTER TABLE print_jobs ADD COLUMN actual_weight_g real;
ALTER TABLE print_jobs ADD COLUMN estimate_snapshot text;
CREATE TABLE print_paper_settings (
 scope text PRIMARY KEY NOT NULL, sheet_cost real, sheet_weight_g real,
 updated_at integer NOT NULL
);
