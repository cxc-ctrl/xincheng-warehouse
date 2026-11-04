import {appendRecipes} from "./recipe-actions";
import {PHYSICAL_UNITS} from "./model";
import {MAX_RECIPE_STOCKS} from "./recipe-limits";
type Validators={str:(v:unknown,max?:number)=>string;qty:(v:unknown,allowZero?:boolean)=>number;cost:(v:unknown)=>number|null;timestamp:(v:unknown)=>number};

// Create paper records and sales recipes in one receipt-guarded transaction.
// Existing paper counts and historical deductions are never overwritten.
export async function appendPaperSetup(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,v:Validators){
 const {str,qty,cost}=v;
 if(!Array.isArray(b.stocks)||b.stocks.length>MAX_RECIPE_STOCKS||!Array.isArray(b.recipes)||b.recipes.length>20||(!b.stocks.length&&!b.recipes.length))throw new Error(`每次最多建立${MAX_RECIPE_STOCKS}种纸张、关联20个销售编码`);
 const stocks=b.stocks.map((s:Record<string,unknown>)=>{
  const code=str(s.code),name=str(s.name,300);
  if(!code||!name||/[\r\n]/.test(code))throw new Error("请填写纸张编码和名称");
  const unit=str(s.unit??"张",10);if(!PHYSICAL_UNITS.includes(unit))throw new Error("请选择正确的实物单位");
  const quantity=s.quantity==null?null:qty(s.quantity),at=quantity==null?null:v.timestamp(s.count_at??now);
  if(at!=null&&at>now+60000)throw new Error("库存起算时间不能在未来");
  return {code,name,unit,spec:str(s.spec||"",500),quantity,at,cost:cost(s.cost),location:str(s.location||""),minimum:qty(s.minimum??10),note:str(s.note||"",1000)};
 });
 const newCodes=new Set<string>(stocks.map(s=>s.code));
 if(newCodes.size!==stocks.length)throw new Error("纸张编码重复");
 for(const s of stocks){
  if(await d.prepare("SELECT code FROM physical_stocks WHERE scope=? AND code=?").bind(scope,s.code).first())throw new Error("纸张已存在，请刷新草稿并复用已有库存："+s.code);
  if(await d.prepare("SELECT code FROM movements WHERE scope=? AND code=? AND kind='physical' LIMIT 1").bind(scope,s.code).first())throw new Error("纸张编码已有历史记录，请换一个前缀："+s.code);
 }
 const recipes=b.recipes.map((r:Record<string,any>)=>{
  const code=str(r.sales_code);
  if(!code||!Array.isArray(r.items)||!r.items.length||r.items.length>MAX_RECIPE_STOCKS)throw new Error(`每个销售编码需关联1～${MAX_RECIPE_STOCKS}种纸张`);
  const items=r.items.map((x:Record<string,unknown>)=>({code:str(x.stock_code),n:qty(x.per_unit,false)}));
  if(items.some(x=>!x.code||x.n>100000)||new Set(items.map(x=>x.code)).size!==items.length)throw new Error("每份用纸数量无效或纸张重复");
  return {code,items,...(Object.hasOwn(r,"cost")?{cost:cost(r.cost),packing_cost:cost(r.packing_cost)??0}:{})};
 });
 if(new Set(recipes.map(r=>r.code)).size!==recipes.length)throw new Error("销售编码重复");
 if(recipes.reduce((n,r)=>n+r.items.length,0)>400)throw new Error("本次关联超过400项，请将销售规格分批关联");
 const times=new Map<string,number|null>(stocks.map(s=>[s.code,s.at]));
 for(const code of new Set<string>(recipes.flatMap(r=>r.items.map(x=>x.code)))){
  if(newCodes.has(code))continue;
  const s=await d.prepare("SELECT count_at FROM physical_stocks WHERE scope=? AND code=? AND archived=0").bind(scope,code).first<{count_at:number|null}>();
  if(!s)throw new Error("实物不存在或已移除："+code);times.set(code,s.count_at);
 }
 for(const s of stocks){
  statements.push(d.prepare("INSERT INTO physical_stocks(scope,code,name,spec,quantity,count_at,cost,location,minimum,note,updated_at,unit) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE "+guard).bind(scope,s.code,s.name,s.spec,s.quantity,s.at,s.cost,s.location,s.minimum,s.note,now,s.unit,scope,rid));
  if(s.quantity!=null)statements.push(d.prepare("INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'physical','实物初始入库',?,'建立共用实物：真实初始库存',?,?,? WHERE "+guard).bind(scope,crypto.randomUUID(),s.code,s.quantity,now,rid,s.unit,scope,rid));
 }
 await appendRecipes(recipes,d,scope,now,rid,statements,guard,v,b.effective_at,times);
}
