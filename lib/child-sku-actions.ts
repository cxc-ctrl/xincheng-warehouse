import {appendPaperSetup} from "./paper-setup-actions";
import {appendRecipes} from "./recipe-actions";
import {PHYSICAL_UNITS} from "./model";
import {appendInventoryCount} from "./count-actions";
import {MAX_RECIPE_STOCKS} from "./recipe-limits";
type Validators={str:(v:unknown,max?:number)=>string;qty:(v:unknown,allowZero?:boolean)=>number;cost:(v:unknown)=>number|null;timestamp:(v:unknown)=>number};

export async function appendChildSkuImport(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,v:Validators){
 if(!Array.isArray(b.stocks)||!b.stocks.length||b.stocks.length>MAX_RECIPE_STOCKS||!Array.isArray(b.recipes)||!b.recipes.length||b.recipes.length>20)throw new Error(`每批最多${MAX_RECIPE_STOCKS}种子SKU、20个销售SKU`);
 const times=new Map<string,number|null>(),newStocks:Record<string,unknown>[]=[],codes=new Set<string>();
 for(const raw of b.stocks){
  const code=v.str(raw.code);if(!code||/[\r\n]/.test(code)||codes.has(code))throw new Error("子SKU编码为空或重复");codes.add(code);
  const old=await d.prepare("SELECT quantity,count_at,archived,unit FROM physical_stocks WHERE scope=? AND code=?").bind(scope,code).first<{quantity:number|null;count_at:number|null;archived:number;unit:string}>();
  if(old?.archived)throw new Error("实物已移除，请先恢复："+code);
  const unit=v.str(raw.unit||old?.unit||"",10);if(!PHYSICAL_UNITS.includes(unit))throw new Error("请填写正确的库存单位："+code);
  if(old&&unit!==(old.unit||"张"))throw new Error("库存单位与已有实物不同："+code);
  const quantity=raw.quantity==null?null:v.qty(raw.quantity);
  const at=quantity==null?null:v.timestamp(raw.count_at??b.count_at);
  if(at!=null&&at>now+60000)throw new Error("盘点时间不能在未来");
  if(!old){newStocks.push({...raw,code,unit,quantity,count_at:at});times.set(code,at);continue;}
  times.set(code,old.count_at);
  // An upload only confirms uncounted records. It can never refill a counted child.
  if(old.quantity==null&&old.count_at==null&&quantity!=null){
   times.set(code,at);
   statements.push(d.prepare("SELECT CASE WHEN "+guard+" AND NOT EXISTS(SELECT 1 FROM physical_stocks WHERE scope=? AND code=? AND quantity IS NULL AND count_at IS NULL) THEN json('库存已变化，请刷新后重新导入') ELSE 1 END").bind(scope,rid,scope,code));
   appendInventoryCount(d,statements,scope,code,quantity,at!,now,rid,guard,true,unit);
   statements.push(d.prepare("UPDATE orders SET updated_at=? WHERE scope=? AND key IN (SELECT order_key FROM order_effective_rules WHERE scope=? AND stock_code=?) AND "+guard).bind(now,scope,scope,code,scope,rid));
  }
 }
 const recipes=b.recipes.map((r:Record<string,any>)=>{
  const code=v.str(r.sales_code);if(!code||!Array.isArray(r.items)||!r.items.length||r.items.length>MAX_RECIPE_STOCKS)throw new Error(`每个销售SKU需关联1～${MAX_RECIPE_STOCKS}种子SKU`);
  const items=r.items.map((i:Record<string,unknown>)=>({code:v.str(i.stock_code),n:v.qty(i.per_unit,false)}));
  if(items.some(i=>!codes.has(i.code)||i.n>100000)||new Set(items.map(i=>i.code)).size!==items.length)throw new Error("子SKU未提供、重复或每份扣减数量无效");
  return {code,items};
 });
 if(new Set(recipes.map(r=>r.code)).size!==recipes.length)throw new Error("销售SKU重复");
 if(newStocks.length)await appendPaperSetup({stocks:newStocks,recipes:[]},d,scope,now,rid,statements,guard,v);
 await appendRecipes(recipes,d,scope,now,rid,statements,guard,v,undefined,times);
}
