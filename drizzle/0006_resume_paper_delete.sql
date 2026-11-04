-- Only explicitly retired recipes may be replaced after historical deductions.
DROP TRIGGER protect_processed_rules_delete;
--> statement-breakpoint
CREATE TRIGGER protect_processed_rules_delete BEFORE DELETE ON stock_rules
WHEN EXISTS(SELECT 1 FROM order_stocks WHERE scope=OLD.scope AND sales_code=OLD.sales_code AND deducted_qty>0)
 AND NOT EXISTS(SELECT 1 FROM retired_recipes WHERE scope=OLD.scope AND sales_code=OLD.sales_code)
BEGIN SELECT RAISE(ABORT,'此规则已产生纸张扣减，请先核对库存后再更换规则'); END;
--> statement-breakpoint
DROP TRIGGER protect_processed_products;
--> statement-breakpoint
CREATE TRIGGER protect_processed_products BEFORE UPDATE OF stock_mode,recipe_at ON products
WHEN (NEW.stock_mode!=OLD.stock_mode OR COALESCE(NEW.recipe_at,0)!=COALESCE(OLD.recipe_at,0))
 AND (EXISTS(SELECT 1 FROM orders WHERE scope=OLD.scope AND code=OLD.code AND deducted_qty>0) OR EXISTS(SELECT 1 FROM order_stocks WHERE scope=OLD.scope AND sales_code=OLD.code AND deducted_qty>0))
 AND NOT (OLD.stock_mode='recipe' AND NEW.stock_mode='recipe' AND EXISTS(SELECT 1 FROM retired_recipes WHERE scope=OLD.scope AND sales_code=OLD.code AND NEW.recipe_at>=retired_at))
BEGIN SELECT RAISE(ABORT,'此商品已产生扣减，无法直接更换库存方式'); END;
--> statement-breakpoint
-- Concurrent restoration must roll back a pending permanent deletion atomically.
CREATE TRIGGER protect_active_paper_delete BEFORE DELETE ON physical_stocks
WHEN OLD.archived=0
BEGIN SELECT RAISE(ABORT,'只能彻底删除已移除的纸张'); END;
