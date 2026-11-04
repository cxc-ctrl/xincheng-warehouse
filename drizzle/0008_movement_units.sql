ALTER TABLE `movements` ADD `unit` text DEFAULT '' NOT NULL;
--> statement-breakpoint
DROP TRIGGER physical_stock_insert;
--> statement-breakpoint
DROP TRIGGER physical_stock_update;
--> statement-breakpoint
CREATE TRIGGER physical_stock_insert AFTER INSERT ON order_stocks
WHEN NEW.reset=0 AND NEW.deducted_qty>0
BEGIN
 UPDATE physical_stocks SET quantity=quantity-NEW.deducted_qty,updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.stock_code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.stock_code,'physical',CASE WHEN COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张')='张' THEN '纸张订单扣减' ELSE '实物订单扣减' END,-NEW.deducted_qty,'销售编码 '||NEW.sales_code||' · 订单 '||COALESCE((SELECT order_id FROM orders WHERE scope=NEW.scope AND key=NEW.order_key),NEW.order_key),NEW.updated_at,NEW.order_key,COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张'));
END;
--> statement-breakpoint
CREATE TRIGGER physical_stock_update AFTER UPDATE ON order_stocks
WHEN NEW.reset=0 AND NEW.deducted_qty!=OLD.deducted_qty
BEGIN
 UPDATE physical_stocks SET quantity=quantity-(NEW.deducted_qty-OLD.deducted_qty),updated_at=NEW.updated_at WHERE scope=NEW.scope AND code=NEW.stock_code AND quantity IS NOT NULL;
 INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) VALUES(NEW.scope,lower(hex(randomblob(16))),NEW.stock_code,'physical',CASE WHEN COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张')='张' THEN '纸张订单扣减' ELSE '实物订单扣减' END,-(NEW.deducted_qty-OLD.deducted_qty),'销售编码 '||NEW.sales_code||' · 订单 '||COALESCE((SELECT order_id FROM orders WHERE scope=NEW.scope AND key=NEW.order_key),NEW.order_key),NEW.updated_at,NEW.order_key,COALESCE((SELECT unit FROM physical_stocks WHERE scope=NEW.scope AND code=NEW.stock_code),'张'));
END;
