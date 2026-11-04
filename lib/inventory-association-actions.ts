import {appendPaperSetup} from "./paper-setup-actions";
import {associationIssue,recipeSnapshot} from "./inventory-association";
import type {Product,PhysicalStock,StockRule} from "./model";
type Validators={str:(v:unknown,max?:number)=>string;qty:(v:unknown,allowZero?:boolean)=>number;cost:(v:unknown)=>number|null;timestamp:(v:unknown)=>number};

export async function appendInventoryAssociation(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,v:Validators){
 if(!Array.isArray(b.groups)||b.groups.length>20||!Array.isArray(b.removed)||!Array.isArray(b.expected))throw new Error("关联资料格式不正确，请重新打开关联窗口。");
 const products=(await d.prepare("SELECT * FROM products WHERE scope=?").bind(scope).all<Product>()).results;
 const stocks=(await d.prepare("SELECT * FROM physical_stocks WHERE scope=?").bind(scope).all<PhysicalStock>()).results;
 const rules=(await d.prepare("SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=?").bind(scope).all<StockRule>()).results;
 const pmap=new Map(products.map(p=>[p.code,p])),smap=new Map(stocks.map(s=>[s.code,s]));
 const target=v.str(b.stock_code??""),removed=b.removed.map((code:unknown)=>v.str(code));
 if(removed.length&&(!target||!smap.has(target)))throw new Error("请选择需要取消关联的原库存。");
 const seen=new Set<string>(),newStocks:any[]=[],recipes:any[]=[];
 for(const group of b.groups){
  const raw=group.stock??{},code=v.str(raw.code),existing=smap.get(code);
  if(!code||!Array.isArray(group.links)||!group.links.length)throw new Error("请填写库存编码并选择销售SKU。");
  if(group.new_stock===true&&existing)throw new Error("库存编码已存在，请复用已有库存："+code);
  if(group.new_stock!==true&&(!existing||existing.archived))throw new Error("库存不存在或已移除，请刷新后选择："+code);
  const stock=existing??{code,name:v.str(raw.name,300),spec:v.str(raw.spec??"",500),unit:v.str(raw.unit,10)};
  const selected:Product[]=[];
  for(const link of group.links){
   const sales=v.str(link.code),n=v.qty(link.per_unit,false),p=pmap.get(sales);
   if(!p||seen.has(sales)||n>100000)throw new Error("销售SKU不存在、重复或扣减数量无效："+sales);
   if(p.stock_mode!=="recipe"&&(p.quantity!=null||p.count_at!=null))throw new Error("该SKU已有独立盘点，请先核对实物库存再改为共用："+sales);
   seen.add(sales);selected.push(p);
   const old=rules.filter(r=>r.sales_code===sales),already=old.some(r=>r.stock_code===code);
   if(!already&&old.length>1)throw new Error("该SKU已有多个实物版面，请从原版面管理关联，避免覆盖："+sales);
   // Editing one component retains every other numeric paper in the recipe.
   const items=already?old.map(r=>({stock_code:r.stock_code,per_unit:r.stock_code===code?n:r.per_unit})):[{stock_code:code,per_unit:n}];
   recipes.push({sales_code:sales,items});
  }
  const linked=products.filter(p=>rules.some(r=>r.stock_code===code&&r.sales_code===p.code)&&!removed.includes(p.code));
  const issue=associationIssue(stock,selected,linked,!!existing);if(issue)throw new Error(issue);
  if(!existing)newStocks.push({...stock,quantity:null,count_at:null,cost:null,minimum:10});
 }
 if(new Set(b.groups.map((g:any)=>g.stock?.code)).size!==b.groups.length)throw new Error("同一库存请合并成一组后保存。");
 if(removed.some((code:string)=>seen.has(code))||new Set(removed).size!==removed.length)throw new Error("取消关联的SKU重复或仍在本次关联中。");
 const affected=[...seen,...removed];if(!affected.length||affected.length>20)throw new Error("每次可修改1～20个销售SKU。");
 const expected=recipeSnapshot(affected,rules);
 if(JSON.stringify(b.expected)!==JSON.stringify(expected))throw new Error("关联已经变化，请关闭窗口、刷新后重新选择。");
 for(const snapshot of expected){
  const conditions=snapshot.rules.map(()=>"EXISTS(SELECT 1 FROM stock_rules WHERE scope=? AND sales_code=? AND stock_code=? AND per_unit=?)");
  statements.push(d.prepare(`SELECT CASE WHEN (SELECT COUNT(*) FROM stock_rules WHERE scope=? AND sales_code=?)=? ${conditions.length?'AND '+conditions.join(' AND '):''} THEN 1 ELSE json('stale inventory association') END WHERE ${guard}`)
   .bind(scope,snapshot.code,snapshot.rules.length,...snapshot.rules.flatMap(r=>[scope,snapshot.code,r.stock_code,r.per_unit]),scope,rid));
  const next=recipes.find(r=>r.sales_code===snapshot.code);
  const unchanged=next&&next.items.length===snapshot.rules.length&&next.items.every((r:any)=>snapshot.rules.some(o=>o.stock_code===r.stock_code&&o.per_unit===r.per_unit));
  if(!unchanged)statements.push(d.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM order_stocks WHERE scope=? AND sales_code=? AND deducted_qty>0) AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND code=? AND deducted_qty>0) THEN 1 ELSE json('inventory recipe already deducted') END WHERE "+guard).bind(scope,snapshot.code,scope,snapshot.code,scope,rid));
 }
 for(const code of removed){
  const old=rules.filter(r=>r.sales_code===code);if(!old.some(r=>r.stock_code===target))throw new Error("该SKU未关联当前库存："+code);
  if(await d.prepare("SELECT order_key FROM order_stocks WHERE scope=? AND sales_code=? AND deducted_qty>0 LIMIT 1").bind(scope,code).first())throw new Error("该SKU已有实际扣减，需核对历史后再修改："+code);
  const rest=old.filter(r=>r.stock_code!==target);
  if(rest.length)recipes.push({sales_code:code,items:rest.map(r=>({stock_code:r.stock_code,per_unit:r.per_unit}))});
  else{
   statements.push(d.prepare("DELETE FROM stock_rules WHERE scope=? AND sales_code=? AND "+guard).bind(scope,code,scope,rid));
   statements.push(d.prepare("UPDATE products SET stock_mode='recipe',quantity=NULL,count_at=NULL,updated_at=? WHERE scope=? AND code=? AND "+guard).bind(now,scope,code,scope,rid));
  }
 }
 if(recipes.length||newStocks.length)await appendPaperSetup({stocks:newStocks,recipes},d,scope,now,rid,statements,guard,v);
 statements.push(d.prepare("INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'physical','修改销售关联',0,?,?,?,COALESCE((SELECT unit FROM physical_stocks WHERE scope=? AND code=?),'') WHERE "+guard)
  .bind(scope,crypto.randomUUID(),target||v.str(b.groups[0].stock.code),`库存清单关联；设置 ${seen.size} 个SKU，取消 ${removed.length} 个；库存数量保持原状`,now,rid,scope,target||b.groups[0].stock.code,scope,rid));
}
