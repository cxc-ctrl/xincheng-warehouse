import {appendStockLoss,readStockLosses} from '../../../lib/stock-loss-actions';
import {appendImportConflict,readImportConflicts} from '../../../lib/import-conflict-actions';
import {appendAlertPolicy} from '../../../lib/stock-alert-policy';
import {trustedSync,sessionUser} from '../../../lib/warehouse-auth';
import {WAREHOUSE_VIEWS,readFastWarehouseView,projectWarehouseView,type WarehouseView} from '../../../lib/warehouse-views';
import {appendWorkOrderExclusion,readWorkOrderExclusions} from '../../../lib/work-order-exclusions';
import {settleAutomaticPrintCosts} from '../../../lib/automatic-print-cost';
import {importReadContext} from '../../../lib/import-read-context';
import {IMPORT_CHUNK_SIZE,IMPORT_TRANSACTION_SIZE} from '../../../lib/import-limits';
import {previewDigitRuleImport,appendDigitRuleImport} from '../../../lib/digit-rule-import';
import {appendAutoPrintAccounting} from '../../../lib/print-accounting';
import {ASSOCIATION_ACTIONS,readAssociationRefresh} from '../../../lib/association-refresh';
import {appendShopAction,readShopData,appendShopSnapshots,shopActionResponse} from '../../../lib/shop-actions';
import {readDigitRuleExport} from '../../../lib/digit-rule-export';
import {appendRemarkRule,previewRemark} from '../../../lib/digit-remark-actions';
import {appendPurchase,readPurchases,readPurchaseDefaults} from '../../../lib/purchase-actions';
import {appendDigitConditionAction,readDigitConditions} from '../../../lib/warehouse-digit-conditions';
import {previewProductSync,appendProductSync,supplyProducts,readProductCenterCosts} from '../../../lib/product-center-sync';
import {readOrderRefresh,ORDER_REFRESH_ACTIONS} from '../../../lib/order-refresh';
import {readPrinting,enrichPrinting,appendPrintingAction} from '../../../lib/printing-actions';
import {readFreightData,appendFreightAction} from '../../../lib/freight-actions';
import {readDigitColors,appendDigitAction} from '../../../lib/digit-color-actions';
import { env } from "../../../server/runtime";
import { getChatGPTUser } from "../../chatgpt-auth";
import { isValid, type OrderLine, type Product } from "../../../lib/model";
import { physicalAction } from "../../../lib/physical-actions";
import {appendCatalogImport} from "../../../lib/catalog-actions";
import {appendInventoryGrouping} from "../../../lib/inventory-grouping-actions";
import { appendInventoryCount } from "../../../lib/count-actions";
import {appendRevokeCount} from "../../../lib/revoke-count";
import {appendOrderImport,appendOrderReview,appendCostSnapshot} from "../../../lib/order-actions";
import {ignoredOrderCode,IGNORED_ORDER_REASON,readImportIgnoreRules} from '../../../lib/order-scope';
import {appendImportIgnore,previewImportIgnore,importIgnorePage} from '../../../lib/import-ignore-actions';
import {appendInventoryAssociation} from "../../../lib/inventory-association-actions";
import {readProductRefresh} from "../../../lib/product-refresh";
import {appendProductDelete,deletedProductResult} from "../../../lib/product-delete";
import {readCostSettings,appendCostAction,appendCountCost} from "../../../lib/fulfillment-actions";
import {readAnalytics,appendAnalyticsAction} from "../../../lib/analytics-actions";
export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
function db(){if(!env.DB)throw new Error("库存数据库暂时不可用");return env.DB;}
function str(v:unknown,max=160){if(typeof v!=="string"||v.length>max)throw new Error("字段长度或格式不正确");return v.trim();}
function qty(v:unknown,allowZero=true){if(typeof v!=="number"||!Number.isSafeInteger(v)||v<(allowZero?0:1)||v>100000000)throw new Error("数量必须是有效整数");return v;}
function cost(v:unknown){if(v==null||v==="")return null;if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>100000000)throw new Error("成本格式不正确");return v;}
function timestamp(v:unknown){if(typeof v!=="number"||!Number.isSafeInteger(v)||v<946684800000||v>4102444800000)throw new Error("时间格式不正确");return v;}
const err=(e:unknown)=>{const message=e instanceof Error?e.message:"操作失败，请重试";return json({error:/malformed JSON/i.test(message)?"数据已变化或超出可操作数量，请刷新后重新核对。":message},400);};
// An empty warehouse stays empty until a user imports or creates products.
export async function GET(req:Request){try{const user=await getChatGPTUser();if(!user)return json({error:"请先登录"},401);const scope=user.userId,d=db();
 const params=req?new URL(req.url).searchParams:new URLSearchParams(),view=(params.get('view')||'all') as WarehouseView;if(!WAREHOUSE_VIEWS.includes(view))return json({error:'页面不存在'},400);
 const fast=await readFastWarehouseView(d,scope,user.displayName,view,params.get('key')??undefined);if(fast)return json(fast);
 const result=await d.batch([d.prepare("SELECT * FROM products WHERE scope=? ORDER BY category,name,code").bind(scope),d.prepare("SELECT o.*,f.refund_amount,f.net_amount,COALESCE((SELECT json_group_array(w.tracking) FROM order_waybills w WHERE w.scope=o.scope AND w.order_key=o.key),'[]') AS tracking_json FROM orders o LEFT JOIN order_finance f ON f.scope=o.scope AND f.order_key=o.key WHERE o.scope=? ORDER BY o.order_time DESC").bind(scope),d.prepare("SELECT * FROM movements WHERE scope=? ORDER BY at DESC LIMIT 300").bind(scope),d.prepare("SELECT * FROM batches WHERE scope=? ORDER BY created_at DESC LIMIT 30").bind(scope),d.prepare("SELECT * FROM physical_stocks WHERE scope=? ORDER BY name,code").bind(scope),d.prepare("SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=? ORDER BY sales_code,stock_code").bind(scope),d.prepare("SELECT os.order_key,os.sales_code,os.stock_code,os.deducted_qty,COALESCE((SELECT unit FROM physical_stocks WHERE scope=os.scope AND code=os.stock_code),(SELECT unit FROM movements WHERE scope=os.scope AND code=os.stock_code AND reference=os.order_key AND unit!='' LIMIT 1),'张') AS unit FROM order_stocks os WHERE os.scope=?").bind(scope),d.prepare("SELECT * FROM order_conflicts WHERE scope=? ORDER BY created_at DESC").bind(scope),d.prepare("SELECT order_key,code,kind,quantity,at FROM order_returns WHERE scope=?").bind(scope)]);
 const settings=await d.prepare("SELECT import_test_mode FROM warehouse_settings WHERE scope=?").bind(scope).first<{import_test_mode:number}>();
 const printing=await readPrinting(d,scope),shopData=await readShopData(d,scope);
 const digits=await readDigitColors(d,scope),digitKeys=new Set(digits.digitFulfillments.map(f=>f.order_key)),printChoices=new Map(digits.digitFulfillments.filter(f=>f.status==='print').map(f=>[f.order_key,f]));
 const routed=new Map<string,{stock_code:string;per_unit:number;quantity:number}[]>();for(const r of digits.digitOrderRules){const a=routed.get(r.order_key)??[];a.push({stock_code:r.stock_code,per_unit:r.per_unit,quantity:r.quantity});routed.set(r.order_key,a);}
 return json(projectWarehouseView({importIgnoreRules:await readImportIgnoreRules(d,scope),workOrderExclusions:await readWorkOrderExclusions(d,scope),...printing,...shopData,products:await supplyProducts(d,scope,result[0].results as Product[]),orders:enrichPrinting((result[1].results as (OrderLine&{tracking_json:string})[]).map(raw=>{const {tracking_json,...rest}=raw;return {...rest,tracking_numbers:JSON.parse(tracking_json)} as OrderLine;}).map(o=>digitKeys.has(o.key)?{...o,stock_items:routed.get(o.key)??[],...(printChoices.has(o.key)?{fulfillment_mode:"print" as const,printing_note:printChoices.get(o.key)!.color}:{})}:o),printing.printJobs),movements:result[2].results,batches:result[3].results,physical:result[4].results,rules:result[5].results,orderStocks:result[6].results,conflicts:result[7].results,returns:result[8].results,importTestMode:settings?.import_test_mode===1,...digits,...await readCostSettings(d,scope),...await readFreightData(d,scope),...await readAnalytics(d,scope),user:user.displayName},view));}catch(e){return err(e);}}
async function orderResponse(d:D1Database,scope:string,b:Record<string,any>){
 if(String(b.action).startsWith('shop_'))return shopActionResponse(b,d,scope);
 if(ASSOCIATION_ACTIONS.has(b.action)){try{return {associationRefresh:await readAssociationRefresh(d,scope,b)};}catch{return {refreshRequired:true};}}
 if(['digit_remark_rule','warehouse_digit_condition','print_rule_save','print_rule_match','print_size_rule','print_paper_settings','print_catalog'].includes(b.action)){
  try{return {printingSettings:{...await readPrinting(d,scope),digitConditions:await readDigitConditions(d,scope)}};}catch{return {refreshRequired:true};}
 }
 if(!ORDER_REFRESH_ACTIONS.has(b.action))return {};
 try{return {orderRefresh:await readOrderRefresh(d,scope,b)};}catch{return {refreshRequired:true};}
}
async function refreshAutomaticCosts(d:D1Database,scope:string,b:Record<string,any>){
 if(b.action==='import'){await settleAutomaticPrintCosts(d,scope,b.lines);return;}
 if(['product_center_sync','print_rule_save','print_rule_match','print_catalog','print_size_rule','print_paper_settings','print_transfer','digit_print','order_review','shop_release','product','import_conflict_resolve'].includes(b.action))await settleAutomaticPrintCosts(d,scope);
}
export async function POST(req:Request):Promise<Response>{try{
 const sync=trustedSync(req),user=sync?sessionUser():await getChatGPTUser();if(!user)return json({error:"请先登录"},401);const origin=req.headers.get("origin");if(origin&&origin!==new URL(req.url).origin&&origin!==process.env.WAREHOUSE_PUBLIC_URL)return json({error:"来源不允许"},403);
 const raw=await req.text();if(raw.length>1000000)return json({error:"请求过大，请分批导入"},413);const b=JSON.parse(raw),scope=user.userId,now=Date.now();let d=db();const rid=str(b.request_id,200);if(!rid)throw new Error("缺少操作编号");
 if(sync&&!['product_center_sync_preview','product_center_sync','product_center_costs'].includes(b.action))return json({error:'同步凭证仅可用于产品资料同步'},403);
 if(b.action==='digit_rules_preview')return json({ok:true,digitImportPreview:await previewDigitRuleImport(d,scope,b.file)});
 if(b.action==='import_ignore_list')return json({ok:true,...await importIgnorePage(d,scope)});
 if(b.action==='import_ignore_preview')return json({ok:true,preview:await previewImportIgnore(d,scope,b)});
 if(b.action==='digit_rules_export')return json({ok:true,digitRuleExport:await readDigitRuleExport(d,scope,now)});
 if(b.action==='digit_remark_preview')return json({ok:true,remarkPreview:await previewRemark(d,scope,b)});
 if(b.action==='stock_loss_list')return json({ok:true,losses:await readStockLosses(d,scope,b)});
 if(b.action==='import_conflict_list')return json({ok:true,staged:await readImportConflicts(d,scope,b)});
 if(b.action==='purchase_list')return json({ok:true,purchases:await readPurchases(d,scope,b)});
 if(b.action==='purchase_defaults')return json({ok:true,defaults:await readPurchaseDefaults(d,scope,b)});
 if(b.action==='product_center_costs')return json({ok:true,stockCosts:await readProductCenterCosts(d,scope,b)});
 if(b.action==='product_center_sync_preview')return json({ok:true,syncPreview:await previewProductSync(d,scope,b)});
 if(b.action==='shop_page')return json({ok:true,shopData:await readShopData(d,scope,b.page)});
 if(b.action==='print_auto_cost_refresh'){await settleAutomaticPrintCosts(d,scope);return json({ok:true});}
 if(await d.prepare("SELECT id FROM receipts WHERE scope=? AND id=?").bind(scope,rid).first()){await refreshAutomaticCosts(d,scope,b);return json({ok:true,repeated:true,...await orderResponse(d,scope,b),...(b.action==="product"?{productRefresh:await readProductRefresh(d,scope,str(b.product?.code))}:b.action==="product_delete"?await deletedProductResult(d,scope,str(b.code)):{})});}
 // Transport batching only: retain the original 40-row stock transaction boundary.
 // A retry reuses each child receipt, so completed chunks cannot deduct twice.
 if(b.action==='import'&&Array.isArray(b.lines)&&b.lines.length>IMPORT_TRANSACTION_SIZE){
  if(b.lines.length>IMPORT_CHUNK_SIZE||rid.length>180)throw new Error('订单导入批次过大');
  if(new Set(b.lines.map((o:OrderLine)=>o.key)).size!==b.lines.length)throw new Error('同一批次的订单明细重复');
  for(let i=0;i<b.lines.length;i+=IMPORT_TRANSACTION_SIZE){
   const headers=new Headers(req.headers);headers.delete('content-length');
   const response=await POST(new Request(req.url,{method:'POST',headers,body:JSON.stringify({...b,request_id:rid+':part:'+i,lines:b.lines.slice(i,i+IMPORT_TRANSACTION_SIZE),final:b.final&&i+IMPORT_TRANSACTION_SIZE>=b.lines.length})}));
   const result=await response.json() as {error?:string};
   if(!response.ok)return json({error:`${result.error??'导入失败'}；本组前${i}条已提交，可继续导入，已提交部分不会重复扣库存。`,processed:i},response.status);
  }
  await d.batch([d.prepare('INSERT OR IGNORE INTO receipts(scope,id,at) VALUES(?,?,?)').bind(scope,rid,now)]);
  return json({ok:true,processed:b.lines.length});
 }
 const statements:D1PreparedStatement[]=[];
 // All mutations and their receipt commit together. Guarded receipt inserts make retries safe.
 const guard="NOT EXISTS(SELECT 1 FROM receipts WHERE scope=? AND id=?)";
 if(await appendImportIgnore(b,d,scope,now,rid,statements,guard)||await appendImportConflict(b,d,scope,now,rid,statements,guard,{str,qty,cost,timestamp})||await appendStockLoss(b,d,scope,user.displayName,now,rid,statements,guard)||await appendAlertPolicy(b,d,scope,now,rid,statements,guard)||await appendWorkOrderExclusion(b,d,scope,now,rid,statements,guard)||await appendShopAction(b,d,scope,now,rid,statements,guard,{str,qty,cost,timestamp})||await appendDigitRuleImport(b,d,scope,now,rid,statements,guard)||await appendRemarkRule(b,d,scope,now,rid,statements,guard)||await appendPurchase(b,d,scope,now,rid,statements,guard)||await appendDigitConditionAction(b,d,scope,now,rid,statements,guard)||await appendProductSync(b,d,scope,now,rid,statements,guard)||await appendPrintingAction(b,d,scope,now,rid,statements,guard)||await appendFreightAction(b,d,scope,now,rid,statements,guard)||await appendDigitAction(b,d,scope,now,rid,statements,guard)||await appendCostAction(b,d,scope,now,rid,statements,guard)||await appendAnalyticsAction(b,d,scope,now,rid,statements,guard)){
  // Configuration and its receipt are committed together.
 }else if(b.action==="product_delete"){
  await appendProductDelete(b,d,scope,rid,statements,guard);
 }else if(b.action==="import_test_mode"){
  if(typeof b.enabled!=="boolean")throw new Error("请选择测试或正式导入模式");
  statements.push(d.prepare(`INSERT INTO warehouse_settings(scope,import_test_mode,active_test_import,updated_at) SELECT ?,?,0,? WHERE ${guard} ON CONFLICT(scope) DO UPDATE SET import_test_mode=excluded.import_test_mode,updated_at=excluded.updated_at`).bind(scope,b.enabled?1:0,now,scope,rid));
 }else if(b.action==="inventory_association"){
  await appendInventoryAssociation(b,d,scope,now,rid,statements,guard,{str,qty,cost,timestamp});
 }else if(b.action==="order_review"){
  await appendOrderReview(b,d,scope,now,rid,statements,guard,{str,qty,cost,timestamp});
 }else if(b.action==="revoke_count"){
  await appendRevokeCount(b,d,scope,now,rid,statements,guard,{str});
 }else if(b.action==="inventory_group"){
  await appendInventoryGrouping(b,d,scope,now,rid,statements,guard,{str,qty,cost,timestamp});
 }else if(b.action==="catalog_import"){
  await appendCatalogImport(b,d,scope,now,rid,statements,guard);
 }else if(await physicalAction(b,d,scope,now,rid,statements,guard,{str,qty,cost,timestamp})){
  // The shared receipt below commits physical stock changes atomically.
 }else if(b.action==="product"){
  const p=b.product??{},code=str(p.code),name=str(p.name,300);if(!code||!name||/[\r\n]/.test(code))throw new Error("请填写独立 SKU 的商家编码和名称");const category=str(p.category??"未分类"),spec=str(p.spec||"",500),pack=str(p.pack||""),unit=str(p.unit||"份",10),price=cost(p.cost),location=str(p.location||""),minimum=qty(p.minimum??10),note=str(p.note||"",1000);
  const existing=await d.prepare("SELECT code,stock_mode,tracking_enabled,tracking_at,packing_cost FROM products WHERE scope=? AND code=?").bind(scope,code).first<{code:string;stock_mode:string;tracking_enabled:number;tracking_at:number|null;packing_cost:number}>();const initial=existing&&b.confirm_count!==true?null:p.quantity==null?null:qty(p.quantity);const at=initial==null?null:timestamp(p.count_at??now);if(at!=null&&at>now+60000)throw new Error("库存起算时间不能在未来");
  const profile=await d.prepare("SELECT config FROM product_supply_profiles WHERE scope=? AND code=?").bind(scope,code).first<{config:string}>();const sourceMode=profile?JSON.parse(profile.config).variant.cost_mode:null;
  if(profile){
   const current=await d.prepare('SELECT name,category,spec,pack,unit,erp_code,size,material,note FROM products WHERE scope=? AND code=?').bind(scope,code).first<Record<string,string>>();
   const expected:Record<string,unknown>={name,category,spec,pack,unit,note,erp_code:p.erp_code??current?.erp_code??'',size:p.size??current?.size??'',material:p.material??current?.material??''};
   if(current&&Object.entries(expected).some(([key,value])=>String(value??'')!==String(current[key]??'')))throw new Error('基础商品资料由产品中心维护，请在产品中心修改并重新同步；仓库可维护库存、库位和预警线');
   statements.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM product_supply_profiles WHERE scope=? AND code=? AND config=?) THEN json('商品资料刚被同步，请重新打开后保存') ELSE 1 END`).bind(scope,rid,scope,code,profile.config));
  }
  if(sourceMode&&((sourceMode==='按实物自动计算'&&price!==null)||(sourceMode==='固定整份成本'&&price!==JSON.parse(profile!.config).variant.cost)))throw new Error('此销售SKU的成本方式由产品中心维护；请在产品中心修改后同步，实物单价仍在仓库维护');
  const tracking=p.tracking_enabled??existing?.tracking_enabled??1;if(![0,1].includes(tracking))throw new Error("请选择库存管理方式");const packingCost=cost(p.packing_cost??existing?.packing_cost??0)??0;
  if(!tracking&&initial!=null)throw new Error("仅统计销售的商品不填写库存数量");if(b.confirm_count===true&&(!tracking||(existing?.tracking_enabled===0&&at!<now-60000)||(existing?.tracking_at!=null&&at!<existing.tracking_at)))throw new Error("重新启用库存后，请按当前实际数量重新盘点");
  if(b.confirm_count===true){if(!existing)throw new Error("新产品请填写初始库存");if(existing.stock_mode==="recipe")throw new Error("共用实物的销售SKU请确认实物库存");if(initial==null||at==null)throw new Error("请填写实际盘点数量和起算时间");}
  if(existing&&b.new_product)throw new Error("商家编码已存在，请使用已有 SKU 补货");
  const mode=p.stock_mode==="recipe"?"recipe":"direct";if(!existing&&mode==="recipe"&&initial!=null)throw new Error("按纸张扣减的销售SKU不填初始库存，请到实物库存登记实际数量");
  const conflict=b.new_product?"":" ON CONFLICT(scope,code) DO UPDATE SET name=excluded.name,category=excluded.category,spec=excluded.spec,pack=excluded.pack,unit=excluded.unit,cost=excluded.cost,location=excluded.location,minimum=excluded.minimum,note=excluded.note,updated_at=excluded.updated_at,packing_cost=excluded.packing_cost,tracking_at=CASE WHEN products.tracking_enabled=0 AND excluded.tracking_enabled=1 THEN COALESCE(excluded.count_at,excluded.updated_at) ELSE products.tracking_at END,tracking_enabled=excluded.tracking_enabled";
  statements.push(d.prepare(`INSERT INTO products(scope,code,name,category,spec,pack,unit,cost,quantity,count_at,location,minimum,note,source,updated_at,stock_mode,tracking_enabled,packing_cost) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'手动新增',?,?,?,? WHERE ${guard}${conflict}`).bind(scope,code,name,category,spec,pack,unit,price,initial,at,location,minimum,note,now,mode,tracking,packingCost,scope,rid));
  for(const field of ["erp_code","size","material"] as const)if(Object.hasOwn(p,field))statements.push(d.prepare(`UPDATE products SET ${field}=? WHERE scope=? AND code=? AND ${guard}`).bind(str(p[field]??""),scope,code,scope,rid));
  if(!existing&&initial!=null)statements.push(d.prepare(`INSERT INTO movements(scope,id,code,type,delta,note,at,reference) SELECT ?,?,?, '初始入库',?,'新增 SKU 的初始库存',?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,initial,now,rid,scope,rid));
  if(!existing&&tracking&&initial!=null)statements.push(d.prepare(`UPDATE orders SET deducted_qty=CASE WHEN shipped_qty>0 AND COALESCE(shipped_at,order_time)>? THEN shipped_qty ELSE 0 END,reset=0,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(at,now,scope,code,scope,rid));
  appendCostSnapshot(d,statements,scope,code,now,rid,guard);
  if(existing&&b.confirm_count===true)appendInventoryCount(d,statements,scope,code,initial!,at!,now,rid,guard);
 }else if(b.action==="count"){
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>10)throw new Error("每次最多盘点 10 个 SKU");const at=timestamp(b.count_at);if(at>now+60000)throw new Error("盘点时间不能在未来");
  for(const p of b.items){const code=str(p.code),n=qty(p.quantity);const product=await d.prepare("SELECT stock_mode,tracking_enabled,tracking_at FROM products WHERE scope=? AND code=?").bind(scope,code).first<{stock_mode:string;tracking_enabled:number;tracking_at:number|null}>();if(!product)throw new Error("SKU 不存在："+code);if(!product.tracking_enabled)throw new Error("该SKU仅统计销售，不盘点库存："+code);if(at<(product.tracking_at??0))throw new Error("盘点时间不能早于重新启用库存的时间");if(product.stock_mode==="recipe")throw new Error("此SKU共用实物库存，请到实物库存盘点："+code);
   await appendCountCost(d,scope,now,rid,statements,guard,"product",{...p,code});
   appendInventoryCount(d,statements,scope,code,n,at,now,rid,guard);
  }
 }else if(b.action==="inbound"){
  const code=str(b.code),n=qty(b.quantity,false),p=await d.prepare("SELECT quantity FROM products WHERE scope=? AND code=? AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0)").bind(scope,code).first<{quantity:number|null}>();if(!p)throw new Error("请先建立这个 SKU");if(p.quantity==null)throw new Error("请先盘点该 SKU 的原有库存，再登记补货");
  statements.push(d.prepare(`UPDATE products SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(n,now,scope,code,scope,rid));
  statements.push(d.prepare(`INSERT INTO movements(scope,id,code,type,delta,note,at,reference) SELECT ?,?,?,'补货入库',?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,n,str(b.note||"补货入库",1000),now,rid,scope,rid));
 }else if(b.action==="adjust"){
  const code=str(b.code);if(typeof b.delta!=="number"||!Number.isSafeInteger(b.delta)||!b.delta||Math.abs(b.delta)>100000000)throw new Error("调整数量无效");const note=str(b.note,1000);if(!note)throw new Error("请填写退货、破损或调整原因");const p=await d.prepare("SELECT quantity FROM products WHERE scope=? AND code=? AND stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0)").bind(scope,code).first<{quantity:number|null}>();if(!p||p.quantity==null)throw new Error("请先盘点这个 SKU");
  statements.push(d.prepare(`UPDATE products SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(b.delta,now,scope,code,scope,rid));
  statements.push(d.prepare(`INSERT INTO movements(scope,id,code,type,delta,note,at,reference) SELECT ?,?,?,'人工调整',?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,b.delta,note,now,rid,scope,rid));
 }else if(b.action==="import"){
  if(!Array.isArray(b.lines)||b.lines.length>IMPORT_CHUNK_SIZE)throw new Error("订单导入批次过大");const batch=str(b.batch_id),filename=str(b.filename,300);if(!batch)throw new Error("缺少导入批次");
  const settings=await d.prepare("SELECT import_test_mode FROM warehouse_settings WHERE scope=?").bind(scope).first<{import_test_mode:number}>(),testMode=settings?.import_test_mode===1;
  const priorBatch=await d.prepare("SELECT test_mode FROM batches WHERE scope=? AND id=?").bind(scope,batch).first<{test_mode:number}>();
  if(priorBatch&&priorBatch.test_mode!==(testMode?1:0))throw new Error("导入模式已变化，请重新选择文件开始新的导入");
  statements.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT import_test_mode FROM warehouse_settings WHERE scope=?),0)<>? THEN json('导入模式已变化，请重新选择文件') ELSE 1 END`).bind(scope,rid,scope,testMode?1:0));
  statements.push(d.prepare(`INSERT INTO batches(scope,id,filename,created_at,total,valid,complete,test_mode) SELECT ?,?,?,?,0,0,0,? WHERE ${guard} ON CONFLICT(scope,id) DO NOTHING`).bind(scope,batch,filename,now,testMode?1:0,scope,rid));
  // This flag exists only inside this atomic import transaction. Counting and
  // other requests must retain their normal time boundary even in test mode.
  if(testMode)statements.push(d.prepare(`UPDATE warehouse_settings SET active_test_import=1 WHERE scope=? AND ${guard}`).bind(scope,scope,rid));
  if(new Set(b.lines.map((o:OrderLine)=>o.key)).size!==b.lines.length)throw new Error("同一批次的订单明细重复");
  const ignoreRules=await readImportIgnoreRules(d,scope);
  for(const o of b.lines.filter((o:OrderLine)=>ignoredOrderCode(o.code,ignoreRules)))statements.push(d.prepare(`INSERT INTO ignored_order_lines(scope,order_key,shop,order_id,code,payload,reason,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,order_key) DO NOTHING`).bind(scope,o.key,o.shop,o.order_id,o.code,JSON.stringify(o),IGNORED_ORDER_REASON,now,scope,rid));
  b.lines=b.lines.filter((o:OrderLine)=>!ignoredOrderCode(o.code,ignoreRules));
  const pendingStaged=new Set((await d.prepare("SELECT order_key FROM import_conflict_groups WHERE scope=? AND status='pending' AND order_key IN(SELECT value FROM json_each(?))").bind(scope,JSON.stringify(b.lines.map((o:OrderLine)=>o.key))).all<{order_key:string}>()).results.map(r=>r.order_key));
  b.lines=b.lines.filter((o:OrderLine)=>!pendingStaged.has(o.key));
  d=await importReadContext(d,scope,b.lines);
  for(const row of b.lines)await appendOrderImport(row,d,scope,now,rid,batch,statements,guard,{str,qty,cost,timestamp},false,testMode);
  await appendAutoPrintAccounting(d,scope,b.lines,now,rid,statements,guard);
  appendShopSnapshots(d,scope,statements,now,rid,guard,b.lines.map((o:OrderLine)=>o.key));
  if(testMode)statements.push(d.prepare(`UPDATE warehouse_settings SET active_test_import=0 WHERE scope=? AND ${guard}`).bind(scope,scope,rid));
  statements.push(d.prepare(`UPDATE batches SET total=total+?,valid=valid+?,complete=? WHERE scope=? AND id=? AND ${guard}`).bind(b.lines.length,b.lines.filter((o:OrderLine)=>isValid(o.status)).length,b.final?1:0,scope,batch,scope,rid));
 }else throw new Error("不支持的操作");
 statements.push(d.prepare("INSERT OR IGNORE INTO receipts(scope,id,at) VALUES(?,?,?)").bind(scope,rid,now));await d.batch(statements);await refreshAutomaticCosts(d,scope,b);return json({ok:true,...await orderResponse(d,scope,b),...(b.action==="product"?{productRefresh:await readProductRefresh(d,scope,str(b.product?.code))}:b.action==="product_delete"?await deletedProductResult(d,scope,str(b.code)):{})});
 }catch(e){return err(e);}}
