import {FIXED_COST} from './cost-pricing';
import {guardAutoStocks} from './product-sync-auto-stock';

type Obj=Record<string,any>;
// Run after every SKU batch has arrived. Never infer from an in-flight mixture
// of old and new pack prices, or distribute a bundle cost across components.
export async function syncPhysicalCosts(d:D1Database,scope:string,raw:Obj,now:number){
 const requested=raw.variants;
 if(!Array.isArray(requested)||!requested.length||requested.length>2000||requested.some(v=>!v||typeof v.sku!=='string'||!v.sku||v.sku.length>160||typeof v.product_id!=='string'||!Number.isSafeInteger(v.revision)||v.revision<1)||new Set(requested.map(v=>v.sku)).size!==requested.length)throw Error('实物成本同步范围无效');
 const codes=JSON.stringify(requested.map(v=>v.sku)),checks:{query:string;args:any[];snapshot:string}[]=[];
 async function read(query:string,args:any[],columns:string[]){
  const aggregate=`SELECT json_group_array(json_object(${columns.map(c=>`'${c}',${c}`).join(',')})) AS snapshot FROM (${query})`;
  const snapshot=(await d.prepare(aggregate).bind(...args).first<{snapshot:string}>())?.snapshot||'[]';
  checks.push({query:aggregate,args,snapshot});return JSON.parse(snapshot) as Obj[];
 }
 const targets='SELECT stock_code FROM stock_rules WHERE scope=? AND sales_code IN(SELECT value FROM json_each(?))';
 const members=`SELECT sales_code FROM stock_rules WHERE scope=? AND stock_code IN(${targets}) UNION SELECT value FROM json_each(?)`;
 const memberArgs=[scope,scope,codes,codes];
 const stocks=await read(`SELECT code,name,unit,cost,archived,updated_at FROM physical_stocks WHERE scope=? AND code IN(${targets}) ORDER BY code`,[scope,scope,codes],['code','name','unit','cost','archived','updated_at']);
 const rules=await read(`SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code IN(${members}) ORDER BY sales_code,stock_code`,[scope,...memberArgs],['sales_code','stock_code','per_unit']);
 const profiles=await read(`SELECT code,source_product,source_revision,config FROM product_supply_profiles WHERE scope=? AND code IN(${members}) ORDER BY code`,[scope,...memberArgs],['code','source_product','source_revision','config']);
 const products=await read(`SELECT code,cost,stock_mode,tracking_enabled,packing_cost FROM products WHERE scope=? AND code IN(${members}) ORDER BY code`,[scope,...memberArgs],['code','cost','stock_mode','tracking_enabled','packing_cost']);
 const digits=await read(`SELECT base_code,stock_code,color FROM digit_stock_variants WHERE scope=? AND (base_code IN(${targets}) OR stock_code IN(${targets})) ORDER BY base_code,color`,[scope,scope,codes,scope,codes],['base_code','stock_code','color']);
 const profileMap=new Map<string,Obj>(profiles.map(p=>[p.code,{...p,variant:JSON.parse(p.config).variant,settings:JSON.parse(p.config)}]));
 for(const v of requested){const p=profileMap.get(v.sku);if(!p||p.source_product!==v.product_id||p.source_revision!==v.revision)throw Error('商品同步版本已变化，请重新同步后核对实物成本：'+v.sku);}
 const changes:Obj[]=[],unchanged:Obj[]=[],skipped:Obj[]=[];
 for(const s of stocks){
  const linked=rules.filter(r=>r.stock_code===s.code),values:{sku:string;cost:number;quantity:number;unit_cost:number}[]=[];
  let reason='',warning=false;
  if(s.archived){reason='实物已归档';warning=true;}
  else if(digits.some(r=>r.base_code===s.code||r.stock_code===s.code))reason='数字贴版面由仓库专用规则维护';
  for(const r of linked){
   if(reason)break;
   const p=profileMap.get(r.sales_code),v=p?.variant,product=products.find(p=>p.code===r.sales_code);
   if(!v||!product){reason='关联SKU缺少产品中心成本资料';warning=true;break;}
   if(['打印定制','定制订单'].includes(v.supply_mode)||v.inventory_mode==='仅统计销售')continue;
   if(v.supply_mode!=='现货'||/数字贴|数码贴/.test((v.category||'')+' '+v.name)||/SZT-/i.test(v.sku)||p.settings.stocks?.some((x:Obj)=>x.code===s.code&&x.kind==='数字贴版面')){reason='条件现货或数字贴使用专用扣减规则，保留仓库实物成本';break;}
   if(product.stock_mode!=='recipe'||rules.filter(x=>x.sales_code===r.sales_code).length!==1){reason='SKU关联多个实物或库存方式不符，不能分摊整份成本';warning=true;break;}
   if(v.cost_mode!==FIXED_COST)continue;
   if(v.cost==null||!Number.isFinite(v.cost)||v.cost<0||product.cost!==v.cost||product.packing_cost){reason='关联SKU的固定整份成本缺失或与同步资料不一致';warning=true;break;}
   if(!Number.isFinite(r.per_unit)||r.per_unit<=0){reason='库存扣减数量无效';warning=true;break;}
   const unit_cost=Number((v.cost/r.per_unit).toFixed(8));
   if(unit_cost>1e8){reason='换算后的实物单价超出允许范围';warning=true;break;}
   values.push({sku:v.sku,cost:v.cost,quantity:r.per_unit,unit_cost});
  }
  if(!reason&&!values.length)reason='没有可换算的固定整份成本（自动成本或不扣库存的SKU）';
  if(!reason&&values.some(v=>v.unit_cost!==values[0].unit_cost)){reason='共用实物的SKU换算单价不一致，请在产品中心核对成本';warning=true;}
  const row={code:s.code,name:s.name,unit:s.unit,codes:linked.map(r=>r.sales_code),old:s.cost,values};
  if(reason){skipped.push({...row,reason,warning});continue;}
  const next=values[0].unit_cost;
  (next===s.cost?unchanged:changes).push({...row,next});
 }
 for(const code of new Set(rules.filter(r=>requested.some(v=>v.sku===r.sales_code)).map(r=>r.stock_code)))if(!stocks.some(s=>s.code===code))skipped.push({code,codes:rules.filter(r=>r.stock_code===code).map(r=>r.sales_code),reason:'关联实物不存在',warning:true});
 for(const v of requested)if(!rules.some(r=>r.sales_code===v.sku)){
  const p=products.find(p=>p.code===v.sku),profile=profileMap.get(v.sku)!.variant;
  const direct=p?.stock_mode==='direct',noStock=['打印定制','定制订单'].includes(profile.supply_mode)||profile.inventory_mode==='仅统计销售';
  skipped.push({code:v.sku,codes:[v.sku],reason:direct?'独立库存采用已同步的SKU整份成本':noStock?'打印或仅统计销售，无需更新实物库存成本':'尚未关联实物库存',warning:!direct&&!noStock});
 }
 const rid=raw.request_id,guard='NOT EXISTS(SELECT 1 FROM receipts WHERE scope=? AND id=?)';
 if(await d.prepare('SELECT id FROM receipts WHERE scope=? AND id=?').bind(scope,rid).first())return {changes:[],unchanged,skipped,repeated:true};
 const statements:D1PreparedStatement[]=[];guardAutoStocks(d,statements,checks,scope,rid,guard);
 for(const change of changes)statements.push(d.prepare(`UPDATE physical_stocks SET cost=?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(change.next,now,scope,change.code,scope,rid));
 statements.push(d.prepare('INSERT OR IGNORE INTO receipts(scope,id,at) VALUES(?,?,?)').bind(scope,rid,now));
 await d.batch(statements);
 return {changes,unchanged,skipped,repeated:false};
}
