import {readHistoricalCountedKeys} from './historical-counted-orders';
import {isUnmatchedOrder} from './order-review-filters';
import {uncountedInventory} from './uncounted-inventory';
import {readAlertPolicy} from './stock-alert-policy';
import type {AlertDemandContext} from './alert-demand';
import type {DigitVariant} from './digit-colors';
import {supplyProducts} from './product-supply-view';
import {readShopData} from './shop-actions';
import {readCostSettings} from './fulfillment-actions';
import {readDigitConditions} from './warehouse-digit-conditions';
import {readRemarkRules} from './digit-remark-actions';
import {readNamedPrintRules} from './named-print-actions';
import {readOrderRefresh} from './order-refresh';
import {cutoffTime} from './order-policy';
import {buildStockAlerts,type StockAlertSnapshot} from './stock-alerts';
import type {Purchase} from './purchasing';
import {warehouseCatalog,inventoryLedger,recipeStock,stockReadiness,summarize,type Product,type PhysicalStock,type StockRule,type OrderLine} from './model';

export const WAREHOUSE_VIEWS=['receiving','ignoreRules','dashboard','stockAlerts','products','paper','purchasing','digitRules','history','shops','printing','import','analysis','freightCheck','all','order','inventoryExport'] as const;
export type WarehouseView=typeof WAREHOUSE_VIEWS[number];
export type DashboardSummary={stockAlerts:StockAlertSnapshot;skuCount:number;categories:number;counted:number;link:number;count:number;uncounted:number;excludedUncounted?:number;qty:number;orderCount:number;alerts:number;reviews:number;unmatched:number;orderAttention:number;top:{code:string;name:string;qty:number}[];movements:{id:string;code:string;name:string;type:string;delta:number;unit:string;note:string;at:number}[];asOf:number};

async function catalog(d:D1Database,scope:string,images=true){
 const r=await d.batch([d.prepare('SELECT * FROM products WHERE scope=? ORDER BY category,name,code').bind(scope),d.prepare('SELECT * FROM physical_stocks WHERE scope=? ORDER BY name,code').bind(scope),d.prepare('SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=? ORDER BY sales_code,stock_code').bind(scope)]);
 let products=r[0].results as Product[];
 if(images)products=await supplyProducts(d,scope,products);
 else {
  const profiles=(await d.prepare("SELECT code,json_extract(config,'$.variant.supply_mode') supply_mode,json_extract(config,'$.variant.cost_mode') cost_mode FROM product_supply_profiles WHERE scope=?").bind(scope).all<{code:string;supply_mode:string;cost_mode:string}>()).results;
  const map=new Map(profiles.map(p=>[p.code,p]));products=products.map(p=>({...p,...map.get(p.code)}));
 }
 return {products,physical:r[1].results as PhysicalStock[],rules:r[2].results as StockRule[]};
}
async function digitConfig(d:D1Database,scope:string){return {digitConditions:await readDigitConditions(d,scope),digitRemarkRules:await readRemarkRules(d,scope),digitVariants:(await d.prepare('SELECT base_code,color,stock_code,size,start,end,available_end FROM digit_stock_variants WHERE scope=?').bind(scope).all()).results};}
async function movements(d:D1Database,scope:string,limit=300){return (await d.prepare('SELECT * FROM movements WHERE scope=? ORDER BY at DESC LIMIT ?').bind(scope,limit).all()).results;}
// Stock demand and review flags require every order, but not notes, money,
// freight bills or printing estimate snapshots. Keep actual digit-board routes.
async function stockOrders(d:D1Database,scope:string){
 const r=await d.batch([
  d.prepare("SELECT o.key,o.code,o.shop,o.order_id,o.title,o.spec,o.buyer_remark,o.seller_remark,o.remarks_available,o.quantity,o.status,o.order_time,o.shipped_at,o.shipped_qty,o.review,o.cutoff_ack_at,o.deducted_qty,CASE WHEN f.status='print' OR (j.order_id IS NOT NULL AND (COALESCE(j.accounting_mode,'whole')!='sku' OR EXISTS(SELECT 1 FROM json_each(j.member_keys) WHERE value=o.key))) THEN 'print' ELSE 'stock' END fulfillment_mode,f.status digit_status FROM orders o LEFT JOIN digit_fulfillments f ON f.scope=o.scope AND f.order_key=o.key LEFT JOIN print_jobs j ON j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id WHERE o.scope=? ORDER BY o.order_time DESC").bind(scope),
  d.prepare("SELECT r.order_key,r.stock_code,1.0*r.per_unit*COALESCE(r.allocated_qty,o.quantity)/o.quantity AS per_unit,COALESCE(r.allocated_qty,o.quantity)*r.per_unit quantity FROM digit_fulfillment_rules r JOIN digit_fulfillments f ON f.scope=r.scope AND f.order_key=r.order_key JOIN orders o ON o.scope=r.scope AND o.key=r.order_key WHERE r.scope=? AND f.status IN('auto','manual')").bind(scope),
  d.prepare('SELECT order_key FROM order_conflicts WHERE scope=?').bind(scope),
  d.prepare('SELECT import_test_mode FROM warehouse_settings WHERE scope=?').bind(scope),
  d.prepare("SELECT order_key FROM import_conflict_groups WHERE scope=? AND status='pending'").bind(scope)
 ]);
 const parts=new Map<string,{stock_code:string;per_unit:number;quantity:number}[]>();
 for(const raw of r[1].results as {order_key:string;stock_code:string;per_unit:number;quantity:number}[]){const {order_key,...item}=raw,a=parts.get(order_key)??[];a.push(item);parts.set(order_key,a);}
 const historical=await readHistoricalCountedKeys(d,scope);
 const orders=(r[0].results as (OrderLine&{digit_status?:string})[]).map(o=>({...o,historical_counted:historical.has(o.key),...(o.digit_status?{stock_items:parts.get(o.key)??[]}:{})}));
 return {orders,conflicts:r[2].results as {order_key:string}[],importConflicts:r[4].results as {order_key:string}[],importTestMode:(r[3].results[0] as {import_test_mode?:number}|undefined)?.import_test_mode===1};
}
export function dashboardSummary(c:{products:Product[];physical:PhysicalStock[];rules:StockRule[]},s:{orders:(OrderLine&{digit_status?:string})[];conflicts:{order_key:string}[];importConflicts?:{order_key:string}[];importTestMode:boolean},recent:any[],now=Date.now(),purchases:Purchase[]=[],policy?:AlertDemandContext):DashboardSummary{
 const smap=new Map(c.physical.map(s=>[s.code,s])),bySku=new Map<string,StockRule[]>();for(const r of c.rules){const a=bySku.get(r.sales_code)??[];a.push(r);bySku.set(r.sales_code,a);}
 const products=c.products.map(p=>recipeStock(p,bySku.get(p.code)??[],smap)),pmap=new Map(products.map(p=>[p.code,p])),warehouse=warehouseCatalog(c.products,c.physical,c.rules),ledger=inventoryLedger(c.products,c.physical,c.rules);
 const states=warehouse.products.map(p=>stockReadiness(p,bySku.get(p.code)??[],smap)),stats=summarize(products,s.orders,30,now),conflicts=new Set(s.conflicts.map(c=>c.order_key));
 // Exclude digit stickers only from this ranking, before selecting its five rows.
 const digitCodes=new Set([...products.filter(p=>/数字贴|数码贴/.test(p.name+' '+p.category)).map(p=>p.code),...(policy?.variants??[]).flatMap(v=>[v.base_code,v.stock_code])]);
 const reviewOrders=s.orders.filter(o=>o.review===1||o.fulfillment_mode!=='print'&&o.digit_status==='pending'&&!o.historical_counted&&(o.shipped_qty??0)>0||conflicts.has(o.key)||cutoffTime(o,pmap.has(o.code)?[pmap.get(o.code)!]:[],c.physical,bySku.get(o.code)??[],s.importTestMode)!=null);
 const reviews=new Set([...reviewOrders.map(o=>o.key),...(s.importConflicts??[]).map(o=>o.order_key)]).size,unmatchedOrders=s.orders.filter(o=>isUnmatchedOrder(o,pmap)),unmatched=unmatchedOrders.length,orderAttention=new Set([...reviewOrders.map(o=>o.key),...unmatchedOrders.map(o=>o.key),...(s.importConflicts??[]).map(o=>o.order_key)]).size;
 const stockAlerts=buildStockAlerts(c.products,c.physical,c.rules,s.orders,purchases,now,policy);
 return {stockAlerts:{...stockAlerts,otherRows:[],ignoredRows:[],partial:true},skuCount:warehouse.products.length,categories:new Set(warehouse.products.map(p=>p.category)).size,counted:stats.counted,link:states.filter(s=>s.label==='待关联'||s.label==='关联需修复').length,count:states.filter(s=>s.label.includes('盘点')).length,uncounted:uncountedInventory(c.products,c.physical,c.rules,policy?.variants,policy?.conditions).length,excludedUncounted:0,qty:stats.qty,orderCount:s.orders.length,alerts:stockAlerts.rows.length,reviews,unmatched,orderAttention,top:[...stats.sales.entries()].filter(([code,s])=>s.qty>0&&!digitCodes.has(code)).sort((a,b)=>b[1].qty-a[1].qty).slice(0,5).map(([code,s])=>({code,name:pmap.get(code)?.name||code||'未填编码',qty:s.qty})),movements:recent.map(m=>({...m,name:(m.kind==='physical'?smap.get(m.code)?.name:pmap.get(m.code)?.name)||m.code,unit:m.unit||(m.kind==='physical'?smap.get(m.code)?.unit:pmap.get(m.code)?.unit)||''})),asOf:now};
}
export async function readFastWarehouseView(d:D1Database,scope:string,user:string,view:WarehouseView,key?:string){
 if(view==='dashboard'||view==='stockAlerts'){
  const c=await catalog(d,scope,false),s=await stockOrders(d,scope),shops=await readShopData(d,scope);
  const purchases=(await d.prepare("SELECT * FROM purchase_orders WHERE scope=? AND status='pending'").bind(scope).all<Purchase>()).results;
  const policy={...await readAlertPolicy(d,scope),...await digitConfig(d,scope)};const context={...policy,variants:policy.digitVariants as DigitVariant[],conditions:policy.digitConditions,remarkRules:policy.digitRemarkRules};
  const common={user,shopPending:shops.shopPending,shopHeldTotal:shops.shopHeldTotal};
  if(view==='dashboard')return {...common,dashboard:dashboardSummary(c,s,await movements(d,scope,5),Date.now(),purchases,context)};
  return {...common,...c,...await readCostSettings(d,scope),stockAlerts:buildStockAlerts(c.products,c.physical,c.rules,s.orders,purchases,Date.now(),context)};
 }
 if(view==='ignoreRules')return {user};
 if(view==='shops')return {user,...await readShopData(d,scope)};
 if(['products','paper','purchasing','digitRules','history','inventoryExport','order'].includes(view)){
  const c=await catalog(d,scope);if(view==='inventoryExport')return c;
  const settings=await d.prepare('SELECT import_test_mode FROM warehouse_settings WHERE scope=?').bind(scope).first<{import_test_mode:number}>();
  const shops=await readShopData(d,scope);
  const result:Record<string,unknown>={user,...c,...await readCostSettings(d,scope),importTestMode:settings?.import_test_mode===1,shopPending:shops.shopPending,shopHeldTotal:shops.shopHeldTotal};
  if(view==='products')Object.assign(result,await stockOrders(d,scope),await digitConfig(d,scope));
  if(view==='digitRules'||view==='order')Object.assign(result,await digitConfig(d,scope),await readNamedPrintRules(d,scope));
  if(view==='history')Object.assign(result,{movements:await movements(d,scope),batches:(await d.prepare('SELECT * FROM batches WHERE scope=? ORDER BY created_at DESC LIMIT 30').bind(scope).all()).results});
  if(view==='order'){if(!key||key.length>1000)throw new Error('订单标识无效');Object.assign(result,{orderRefresh:await readOrderRefresh(d,scope,{key})});}
  return result;
 }
 return null;
}
// Full-domain calculations run before trimming. Monetary allocations and
// snapshots are unchanged; only unrelated payload sections are omitted.
export function projectWarehouseView(data:Record<string,any>,view:WarehouseView){
 if(view==='all')return data;
 const out={...data};
 if(view!=='printing')out.printJobs=data.printJobs.map((j:any)=>{const {estimate_snapshot,...rest}=j;return rest;});
 if(view!=='analysis'&&view!=='freightCheck'){delete out.freightBills;delete out.freightImports;delete out.freightPeriods;delete out.shopAssignments;delete out.productLifecycle;delete out.inventoryReceipts;}
 if(view==='freightCheck'){for(const key of ['printJobs','printEvents','digitOrderRules','digitFulfillments','orderStocks','printRuleMatches'])delete out[key];}
 return out;
}
