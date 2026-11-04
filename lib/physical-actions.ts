import {appendInventoryCount} from "./count-actions";
import {appendPaperSetup} from "./paper-setup-actions";
import {appendRecipes} from "./recipe-actions";
import {appendSharedStock} from "./shared-stock-actions";
import {appendChildSkuImport} from "./child-sku-actions";
import {PHYSICAL_UNITS} from "./model";
import {MAX_RECIPE_STOCKS} from "./recipe-limits";
import {appendCountCost} from "./fulfillment-actions";

type Validators = {
 str: (v: unknown, max?: number) => string;
 qty: (v: unknown, allowZero?: boolean) => number;
 cost: (v: unknown) => number | null;
 timestamp: (v: unknown) => number;
};

// Each statement shares the receipt guard and commits in the route's D1 batch.
export async function physicalAction(
 b: Record<string, any>, d: D1Database, scope: string, now: number,
 rid: string, statements: D1PreparedStatement[], guard: string, v: Validators,
): Promise<boolean> {
 const {str, qty, cost, timestamp} = v;
 if(b.action === "child_sku_import"){
  await appendChildSkuImport(b,d,scope,now,rid,statements,guard,v);return true;
 }
 if(b.action === "shared_stock_setup"){
  await appendSharedStock(b,d,scope,now,rid,statements,guard,v);return true;
 }
 if(b.action === "paper_setup"){
  await appendPaperSetup(b,d,scope,now,rid,statements,guard,v);
  return true;
 }
 const movement = (code: string, type: string, delta: number, note: string, unit?:string) => {
  statements.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'physical',?,?,?,?,?,COALESCE(?,(SELECT unit FROM physical_stocks WHERE scope=? AND code=?),'张') WHERE ${guard}`)
   .bind(scope, crypto.randomUUID(), code, type, delta, note, now, rid, unit??null,scope,code,scope,rid));
 };
 const replay = (code: string) => {
  statements.push(d.prepare(`UPDATE orders SET updated_at=? WHERE scope=? AND key IN (SELECT order_key FROM order_effective_rules WHERE scope=? AND stock_code=?) AND ${guard}`)
   .bind(now, scope, scope, code, scope, rid));
 };
 if (b.action === "warning_preference") {
  const code = str(b.code);
  if (!["product","physical"].includes(b.kind) || typeof b.ignored !== "boolean") throw new Error("预警设置无效");
  const table = b.kind === "physical" ? "physical_stocks" : "products";
  if (!await d.prepare(`SELECT code FROM ${table} WHERE scope=? AND code=?`).bind(scope,code).first()) throw new Error("库存记录不存在");
  statements.push(d.prepare(`UPDATE ${table} SET ignore_warning=?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(b.ignored?1:0,now,scope,code,scope,rid));
  return true;
 }
 if (b.action === "physical_archive") {
  const code = str(b.code);
  const stock = await d.prepare("SELECT code,name,archived FROM physical_stocks WHERE scope=? AND code=?").bind(scope,code).first<{code:string;name:string;archived:number}>();
  if (!stock) throw new Error("纸张不存在");
  if (stock.archived) return true;
  statements.push(d.prepare(`UPDATE physical_stocks SET archived=1,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(now,scope,code,scope,rid));
  movement(code,"移除纸张",0,"移出实物库存统计并暂停该纸张扣减；历史记录保留，可恢复后重新盘点");
  return true;
 }
 if (b.action === "physical_restore") {
  const code = str(b.code),n=qty(b.quantity);
  const stock=await d.prepare("SELECT archived,unit FROM physical_stocks WHERE scope=? AND code=?").bind(scope,code).first<{archived:number;unit:string}>();
  if (!stock?.archived) throw new Error("请选择已移除的纸张");
  statements.push(d.prepare(`UPDATE physical_stocks SET archived=0,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(now,scope,code,scope,rid));
  appendInventoryCount(d,statements,scope,code,n,now,now,rid,guard,true,stock.unit);
  movement(code,"恢复纸张",0,"恢复实物记录并按本次真实库存重新起算");
  replay(code);
  return true;
 }
 if (b.action === "physical_delete") {
  const code = str(b.code);
  const stock = await d.prepare("SELECT name,archived,unit FROM physical_stocks WHERE scope=? AND code=?").bind(scope,code).first<{name:string;archived:number;unit:string}>();
  if (!stock?.archived) throw new Error("只能彻底删除已移除的纸张");
  // Retire the entire affected recipe, so deleting one component cannot silently
  // turn a multi-paper shipment into a smaller recipe. Sales and audits stay intact.
  statements.push(d.prepare(`INSERT INTO retired_recipes(scope,sales_code,retired_at) SELECT scope,sales_code,? FROM stock_rules WHERE scope=? AND stock_code=? AND ${guard} ON CONFLICT(scope,sales_code) DO UPDATE SET retired_at=excluded.retired_at`).bind(now,scope,code,scope,rid));
  statements.push(d.prepare(`DELETE FROM stock_rules WHERE scope=? AND sales_code IN (SELECT sales_code FROM retired_recipes WHERE scope=? AND retired_at=?) AND ${guard}`).bind(scope,scope,now,scope,rid));
  statements.push(d.prepare(`DELETE FROM physical_stocks WHERE scope=? AND code=? AND ${guard}`).bind(scope,code,scope,rid));
  statements.push(d.prepare(`DELETE FROM inventory_weights WHERE scope=? AND code=? AND kind='physical' AND ${guard}`).bind(scope,code,scope,rid));
  movement(code,"彻底删除实物",0,`已删除实物档案：${stock.name}；关联规则已暂停，需重新设置；历史订单与扣减流水保留`,stock.unit);
  return true;
 }
 if (b.action === "physical_product") {
  const p = b.product ?? {};
  const code = str(p.code), name = str(p.name, 300);
  if (!code || !name || /[\r\n]/.test(code)) throw new Error("请填写纸张内部编码和名称");
  const exists = await d.prepare("SELECT code,archived,unit FROM physical_stocks WHERE scope=? AND code=?").bind(scope, code).first<{code:string;archived:number;unit:string}>();
  const unit=str(p.unit??exists?.unit??"张",10);if(!PHYSICAL_UNITS.includes(unit))throw new Error("请选择正确的实物单位");
  if (exists?.archived) throw new Error("这份纸张已移除，请先恢复并确认真实库存");
  if (exists && b.new_product) throw new Error("纸张编码已存在，请使用已有纸张补货");
  if (!exists && await d.prepare("SELECT code FROM movements WHERE scope=? AND code=? AND kind='physical' LIMIT 1").bind(scope,code).first()) throw new Error("该纸张编码已有历史记录，请使用新的内部编码，避免混淆历史库存");
  const n = exists&&b.confirm_count!==true?null:p.quantity == null ? null : qty(p.quantity);
  const at = n == null ? null : timestamp(p.count_at ?? now);
  if (at != null && at > now + 60000) throw new Error("库存起算时间不能在未来");
  if (b.confirm_count === true && (!exists || n == null || at == null)) throw new Error("请填写已有纸张的实际盘点数量和起算时间");
  const conflict = b.new_product ? "" : " ON CONFLICT(scope,code) DO UPDATE SET name=excluded.name,spec=excluded.spec,cost=excluded.cost,location=excluded.location,minimum=excluded.minimum,note=excluded.note,updated_at=excluded.updated_at,unit=excluded.unit";
  statements.push(d.prepare(`INSERT INTO physical_stocks(scope,code,name,spec,quantity,count_at,cost,location,minimum,note,updated_at,unit) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}${conflict}`)
   .bind(scope, code, name, str(p.spec || "", 500), n, at, cost(p.cost), str(p.location || ""), qty(p.minimum ?? 10), str(p.note || "", 1000), now, unit, scope, rid));
  if (!exists && n != null) movement(code, unit==="张"?"纸张初始入库":"实物初始入库", n, "实际实物初始库存");
  if (exists && b.confirm_count === true) {appendInventoryCount(d,statements,scope,code,n!,at!,now,rid,guard,true,unit);replay(code);}
  return true;
 }
 if (b.action === "stock_rule") {
  if (!Array.isArray(b.sales_codes) || !b.sales_codes.length || b.sales_codes.length > 20) throw new Error("每次可关联1～20个销售编码");
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > MAX_RECIPE_STOCKS) throw new Error(`请设置每份实际使用的纸张，最多${MAX_RECIPE_STOCKS}种`);
  const codes: string[] = [...new Set<string>(b.sales_codes.map((c: unknown) => str(c)))];
  const times=new Map<string,number|null>();
  const items = b.items.map((r: Record<string, unknown>) => ({code: str(r.stock_code), n: qty(r.per_unit, false)}));
  if (new Set(items.map(r => r.code)).size !== items.length) throw new Error("同一种纸张请合并为一行");
  for (const r of items) {
   if (r.n > 100000) throw new Error("每份用纸数量过大，请核对");
   const s=await d.prepare("SELECT count_at FROM physical_stocks WHERE scope=? AND code=? AND archived=0").bind(scope,r.code).first<{count_at:number|null}>();
   if(!s)throw new Error("请先建立或恢复实物库存："+r.code);times.set(r.code,s.count_at);
  }
  await appendRecipes(codes.map(code=>({code,items})),d,scope,now,rid,statements,guard,v,b.effective_at,times);
  return true;
 }
 if (b.action === "physical_count") {
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 10) throw new Error("每次最多盘点10种实物纸张");
  if (new Set(b.items.map((p: any) => p.code)).size !== b.items.length) throw new Error("纸张编码重复");
  const at = timestamp(b.count_at);
  if (at > now + 60000) throw new Error("盘点时间不能在未来");
  for (const p of b.items) {
   const code = str(p.code), n = qty(p.quantity);
   const s=await d.prepare("SELECT unit FROM physical_stocks WHERE scope=? AND code=? AND archived=0").bind(scope,code).first<{unit:string}>();
   if(!s)throw new Error("实物不存在或已移除："+code);
   await appendCountCost(d,scope,now,rid,statements,guard,"physical",{...p,code});
   appendInventoryCount(d,statements,scope,code,n,at,now,rid,guard,true,s.unit);
  }
  for (const p of b.items) replay(str(p.code));
  return true;
 }
 if (b.action === "physical_inbound" || b.action === "physical_adjust") {
  const code = str(b.code);
  const p = await d.prepare("SELECT quantity,unit FROM physical_stocks WHERE scope=? AND code=? AND archived=0").bind(scope, code).first<{quantity: number | null;unit:string}>();
  if (!p || p.quantity == null) throw new Error("请先建立并盘点这份实物纸张");
  let n: number, note: string;
  if (b.action === "physical_inbound") {
   n = qty(b.quantity, false); note = str(b.note || "生产补货", 1000);
  } else {
   if (!Number.isSafeInteger(b.delta) || !b.delta || Math.abs(b.delta) > 100000000) throw new Error("调整数量无效");
   n = b.delta; note = str(b.note, 1000);
   if (!note) throw new Error("请填写调整原因");
  }
  statements.push(d.prepare(`UPDATE physical_stocks SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(n, now, scope, code, scope, rid));
  movement(code, b.action === "physical_inbound" ? (p.unit==="张"?"纸张补货入库":"实物补货入库") : (p.unit==="张"?"纸张人工调整":"实物人工调整"), n, note);
  return true;
 }
 return false;
}
