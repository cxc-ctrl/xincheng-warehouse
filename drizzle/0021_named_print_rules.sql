CREATE TABLE print_rules (
 scope text NOT NULL, id text NOT NULL, name text NOT NULL, material text NOT NULL,
 per_sheet integer, sheet_weight_g real, print_cost real,
 laminated integer NOT NULL DEFAULT 0, lamination_cost real,
 cutting text NOT NULL DEFAULT 'none', flat_cut_cost real, die_cut_cost real,
 enabled integer NOT NULL DEFAULT 1, note text NOT NULL DEFAULT '', updated_at integer NOT NULL,
 PRIMARY KEY(scope,id)
);
CREATE TABLE print_rule_links (
 scope text NOT NULL, code text NOT NULL, rule_id text NOT NULL,
 per_pack_override integer, updated_at integer NOT NULL, PRIMARY KEY(scope,code)
);
CREATE TABLE print_rule_matches (
 scope text NOT NULL, shop text NOT NULL, order_id text NOT NULL, code text NOT NULL,
 rule_id text NOT NULL, per_pack_override integer, updated_at integer NOT NULL,
 PRIMARY KEY(scope,shop,order_id,code)
);
-- Preserve earlier configured rules as editable records. Size rules require
-- explicit SKU association; never infer or create a printing task here.
INSERT INTO print_rules(scope,id,name,material,per_sheet,sheet_weight_g,print_cost,enabled,note,updated_at)
SELECT s.scope,'size:'||s.size_cm,s.size_cm||'cm数字贴（原规则）','',s.per_sheet,
 COALESCE(s.sheet_weight_g,p.sheet_weight_g),COALESCE(s.sheet_cost,p.sheet_cost),s.enabled,
 '原尺寸配置已保留，请补充材质并关联产品。',s.updated_at
FROM print_size_rules s LEFT JOIN print_paper_settings p ON p.scope=s.scope;
INSERT INTO print_rules(scope,id,name,material,per_sheet,sheet_weight_g,print_cost,enabled,note,updated_at)
SELECT c.scope,'sku:'||c.code,c.name,c.material,CASE WHEN c.layout_mode='manual' THEN NULL ELSE c.per_sheet END,
 COALESCE(c.sheet_weight_g,p.sheet_weight_g),COALESCE(c.sheet_cost,p.sheet_cost),c.enabled,
 c.note||CASE WHEN c.layout_mode='manual' THEN '；原规则需要人工核定版面，请核对可拼数量。' ELSE '' END,c.updated_at
FROM print_catalog c LEFT JOIN print_paper_settings p ON p.scope=c.scope;
INSERT INTO print_rule_links(scope,code,rule_id,per_pack_override,updated_at)
SELECT scope,code,'sku:'||code,per_pack,updated_at FROM print_catalog;
