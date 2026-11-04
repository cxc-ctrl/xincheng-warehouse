import {appendCostSnapshot} from './order-actions';
type Recipe={code:string;items:{code:string;n:number}[];cost?:number|null;packing_cost?:number};
type Validators={timestamp:(v:unknown)=>number};
export async function appendRecipes(recipes:Recipe[],d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,v:Validators,effectiveAt:unknown,stockTimes:Map<string,number|null>){
 if(recipes.reduce((n,r)=>n+r.items.length,0)>400)throw new Error("本次关联超过400项，请分批保存");
 const requested=effectiveAt==null?null:v.timestamp(effectiveAt);
 if(requested!=null&&requested>now+60000)throw new Error("关联起算时间不能在未来");
 for(const r of recipes){
  const p=await d.prepare("SELECT stock_mode,recipe_at,tracking_enabled FROM products WHERE scope=? AND code=?").bind(scope,r.code).first<{stock_mode:string;recipe_at:number|null;tracking_enabled:number}>();
  if(!p)throw new Error("请先建立ERP销售SKU："+r.code);
  if(await d.prepare("SELECT key FROM orders WHERE scope=? AND code=? AND deducted_qty>0 LIMIT 1").bind(scope,r.code).first())throw new Error("该编码已有独立成品扣减，请先核对库存："+r.code);
  const old=(await d.prepare("SELECT stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code=?").bind(scope,r.code).all<{stock_code:string;per_unit:number}>()).results;
  const same=p.stock_mode==='recipe'&&old.length===r.items.length&&r.items.every(x=>old.some(o=>o.stock_code===x.code&&o.per_unit===x.n));
  const retired=await d.prepare("SELECT retired_at FROM retired_recipes WHERE scope=? AND sales_code=?").bind(scope,r.code).first();
  const used=!!await d.prepare("SELECT order_key FROM order_stocks WHERE scope=? AND sales_code=? AND deducted_qty>0 LIMIT 1").bind(scope,r.code).first();
  if(!same&&!retired&&used)throw new Error("该编码已有实物扣减，不能覆盖历史规则："+r.code);
  const counts=r.items.map(x=>stockTimes.get(x.code)).filter((at):at is number=>at!=null);
  const at=retired?now:requested??(counts.length?Math.min(...counts):now);
  if(!same){
   statements.push(d.prepare("DELETE FROM stock_rules WHERE scope=? AND sales_code=? AND "+guard).bind(scope,r.code,scope,rid));
   for(const x of r.items)statements.push(d.prepare("INSERT INTO stock_rules(scope,sales_code,stock_code,per_unit) SELECT ?,?,?,? WHERE "+guard).bind(scope,r.code,x.code,x.n,scope,rid));
   statements.push(d.prepare("UPDATE products SET stock_mode='recipe',recipe_at=?,quantity=NULL,count_at=NULL,updated_at=? WHERE scope=? AND code=? AND "+guard).bind(at,now,scope,r.code,scope,rid));
  }else if(!used&&at!==p.recipe_at){
   statements.push(d.prepare("UPDATE products SET recipe_at=?,updated_at=? WHERE scope=? AND code=? AND "+guard).bind(at,now,scope,r.code,scope,rid));
  }
  statements.push(d.prepare("UPDATE products SET tracking_at=CASE WHEN tracking_enabled=0 THEN ? ELSE tracking_at END,tracking_enabled=1,updated_at=? WHERE scope=? AND code=? AND "+guard).bind(now,now,scope,r.code,scope,rid));
  if(r.cost!==undefined)statements.push(d.prepare("UPDATE products SET cost=?,packing_cost=?,updated_at=? WHERE scope=? AND code=? AND "+guard).bind(r.cost,r.packing_cost??0,now,scope,r.code,scope,rid));
  statements.push(d.prepare("DELETE FROM retired_recipes WHERE scope=? AND sales_code=? AND "+guard).bind(scope,r.code,scope,rid));
  appendCostSnapshot(d,statements,scope,r.code,now,rid,guard);
  statements.push(d.prepare("UPDATE orders SET updated_at=? WHERE scope=? AND code=? AND "+guard).bind(now,scope,r.code,scope,rid));
 }
}
