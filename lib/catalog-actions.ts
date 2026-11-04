import {validateCatalog,assertCatalogIdentity,type CatalogItem} from "./catalog";
import {appendCostSnapshot} from "./order-actions";

// New metadata + optional shared pool + rules commit as one batch. Actual
// quantities remain unknown until a warehouse count confirms each record.
export async function appendCatalogImport(b:Record<string,unknown>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string){
 if(!Array.isArray(b.items)||b.items.length>20)throw new Error("每次最多建档20个SKU");
 const items=validateCatalog(b.items as CatalogItem[]),stocks=new Map<string,{unit:string;archived:number;count_at:number|null}|null>();
 for(const item of items){
  if(await d.prepare("SELECT code FROM products WHERE scope=? AND code=?").bind(scope,item.code).first())throw new Error("SKU已存在，请刷新后跳过该项："+item.code);
  if(item.inventory_mode==='共用库存'){
   const linked=await d.prepare('SELECT p.name,p.size,p.material FROM products p JOIN stock_rules r ON r.scope=p.scope AND r.sales_code=p.code WHERE r.scope=? AND r.stock_code=?').bind(scope,item.stock_code).all<{name:string;size:string;material:string}>();
   assertCatalogIdentity(item,linked.results);
  }
  if(item.inventory_mode==="共用库存"&&!stocks.has(item.stock_code)){
   const old=await d.prepare("SELECT unit,archived,count_at FROM physical_stocks WHERE scope=? AND code=?").bind(scope,item.stock_code).first<{unit:string;archived:number;count_at:number|null}>();
   if(old&&(old.archived||old.unit!==item.pack_unit))throw new Error("共用库存已移除或库存单位不一致："+item.stock_code);
   stocks.set(item.stock_code,old);
   if(!old)statements.push(d.prepare(`INSERT INTO physical_stocks(scope,code,name,spec,unit,quantity,count_at,cost,location,minimum,note,updated_at) SELECT ?,?,?,?,?,NULL,NULL,NULL,'',10,?,? WHERE ${guard}`)
    .bind(scope,item.stock_code,item.stock_code+" 共用库存",[item.size,item.material].filter(Boolean).join("；"),item.pack_unit,"新品模板建档；实际库存待仓库盘点",now,scope,rid));
  }
 }
 for(const item of items){
  const recipe=item.inventory_mode==="共用库存"||item.inventory_mode==="待关联",at=recipe?(stocks.get(item.stock_code)?.count_at??now):null;
  statements.push(d.prepare(`INSERT INTO products(scope,code,name,category,spec,pack,unit,cost,quantity,count_at,location,minimum,note,source,updated_at,stock_mode,recipe_at,tracking_enabled,erp_code,size,material) SELECT ?,?,?,?,?,?,'份',?,NULL,NULL,'',10,?,'新品模板导入',?,?,?,?,?,?,? WHERE ${guard}`)
   .bind(scope,item.code,item.name,item.category,item.size,item.pack_quantity+item.pack_unit,item.cost,item.note,now,recipe?"recipe":"direct",at,item.inventory_mode==="仅统计销售"?0:1,item.erp_code,item.size,item.material,scope,rid));
  if(item.inventory_mode==="共用库存")statements.push(d.prepare(`INSERT INTO stock_rules(scope,sales_code,stock_code,per_unit) SELECT ?,?,?,? WHERE ${guard}`).bind(scope,item.code,item.stock_code,item.pack_quantity,scope,rid));
  appendCostSnapshot(d,statements,scope,item.code,now,rid,guard);
  statements.push(d.prepare(`UPDATE orders SET updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(now,scope,item.code,scope,rid));
 }
}
