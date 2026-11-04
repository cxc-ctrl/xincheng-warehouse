import {sourceDetails,sourceNeedsReview,validateSource} from './order-sources';
import {appendSupplyImport} from './product-center-sync';
import {appendPrintingImport} from './printing-actions';
import {financeFields,appendOrderFinance} from './freight-actions';
import {appendDigitImport} from './digit-color-actions';
import {isValid,type OrderLine} from './model';
import {importDecision,orderFingerprint,type OrderConflict} from './order-policy';
import {MAX_RECIPE_STOCKS} from './recipe-limits';
type Validators={str:(v:unknown,max?:number)=>string;qty:(v:unknown,allowZero?:boolean)=>number;cost:(v:unknown)=>number|null;timestamp:(v:unknown)=>number};
const costSql=`SELECT COALESCE(p.cost,CASE WHEN p.stock_mode='recipe' AND EXISTS(SELECT 1 FROM stock_rules WHERE scope=p.scope AND sales_code=p.code) AND NOT EXISTS(SELECT 1 FROM stock_rules r LEFT JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code WHERE r.scope=p.scope AND r.sales_code=p.code AND (s.cost IS NULL OR s.archived=1)) THEN (SELECT SUM(s.cost*r.per_unit) FROM stock_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code WHERE r.scope=p.scope AND r.sales_code=p.code)+p.packing_cost ELSE NULL END) AS value FROM products p WHERE p.scope=? AND p.code=?`;
export function appendCostSnapshot(d:D1Database,ss:D1PreparedStatement[],scope:string,code:string,now:number,rid:string,guard:string){
 ss.push(d.prepare(`UPDATE orders SET unit_cost_snapshot=(${costSql}),updated_at=? WHERE scope=? AND code=? AND shipped_qty>0 AND unit_cost_snapshot IS NULL AND NOT EXISTS(SELECT 1 FROM digit_fulfillments f WHERE f.scope=orders.scope AND f.order_key=orders.key) AND ${guard}`).bind(scope,code,now,scope,code,scope,rid));
}
function appendShipmentRebase(d:D1Database,ss:D1PreparedStatement[],scope:string,key:string,at:number,shipped:number,now:number,rid:string,guard:string){
 // Adjust only active, confirmed inventories. Pending/retired components keep history.
 ss.push(d.prepare(`UPDATE order_stocks SET deducted_qty=CASE WHEN EXISTS(SELECT 1 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code WHERE r.scope=order_stocks.scope AND r.order_key=order_stocks.order_key AND r.sales_code=order_stocks.sales_code AND r.stock_code=order_stocks.stock_code AND s.count_at<? AND p.recipe_at<=?) THEN (SELECT COALESCE(allocated_qty,?)*per_unit FROM order_effective_rules WHERE scope=order_stocks.scope AND order_key=order_stocks.order_key AND sales_code=order_stocks.sales_code AND stock_code=order_stocks.stock_code) ELSE 0 END,reset=0,updated_at=? WHERE scope=? AND order_key=? AND EXISTS(SELECT 1 FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code WHERE r.scope=order_stocks.scope AND r.order_key=order_stocks.order_key AND r.sales_code=order_stocks.sales_code AND r.stock_code=order_stocks.stock_code AND s.archived=0 AND p.tracking_enabled=1 AND s.quantity IS NOT NULL AND s.count_at>=COALESCE(p.tracking_at,0)) AND ${guard}`).bind(at,at,shipped,now,scope,key,scope,rid));
 ss.push(d.prepare(`UPDATE orders SET deducted_qty=CASE WHEN EXISTS(SELECT 1 FROM products WHERE scope=orders.scope AND code=orders.code AND stock_mode='direct' AND tracking_enabled=1 AND quantity IS NOT NULL AND count_at>=COALESCE(tracking_at,0)) THEN CASE WHEN (SELECT count_at FROM products WHERE scope=orders.scope AND code=orders.code)<? THEN shipped_qty ELSE 0 END ELSE deducted_qty END,reset=0,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(at,now,scope,key,scope,rid));
}
function guardOrder(d:D1Database,ss:D1PreparedStatement[],scope:string,o:OrderLine,rid:string,guard:string){
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND status=? AND quantity=? AND order_time=? AND amount IS ? AND cost IS ? AND shipped_at IS ? AND source_updated_at IS ? AND shipped_qty=? AND cutoff_ack_at IS ? AND buyer_remark=? AND seller_remark=? AND source_details=?) THEN json('订单已更新，请刷新后重试') ELSE 1 END`).bind(scope,rid,scope,o.key,o.status,o.quantity,o.order_time,o.amount,o.cost,o.shipped_at??null,o.source_updated_at??null,o.shipped_qty??0,o.cutoff_ack_at??null,o.buyer_remark??'',o.seller_remark??'',o.source_details??''));
}
export async function appendOrderImport(raw:OrderLine,d:D1Database,scope:string,now:number,rid:string,batch:string,ss:D1PreparedStatement[],guard:string,v:Validators,force=false,ignoreCutoff=false,confirmSourceShipment=false,releaseStaged=false){
 const {str,qty,cost,timestamp}=v;
 if(typeof raw.shop!=="string"||!raw.shop.trim())throw new Error("店铺编码为空，请先在店铺配置的暂存订单中补齐店铺");
 const o:OrderLine={...financeFields(raw),key:str(raw.key,1000),order_id:str(raw.order_id),shop:str(raw.shop),platform:str(raw.platform,30),code:str(raw.code),title:str(raw.title,1000),spec:str(raw.spec,1000),quantity:qty(raw.quantity,false),status:str(raw.status,40),order_time:timestamp(raw.order_time),amount:cost(raw.amount),cost:cost(raw.cost),shipped_at:raw.shipped_at==null?null:timestamp(raw.shipped_at),source_updated_at:raw.source_updated_at==null?null:timestamp(raw.source_updated_at),buyer_remark:raw.buyer_remark===undefined?undefined:str(raw.buyer_remark,4000),seller_remark:raw.seller_remark===undefined?undefined:str(raw.seller_remark,4000),remarks_available:raw.remarks_available===undefined?undefined:raw.remarks_available?1:0};
 if(!o.order_id||o.key!==JSON.stringify([o.shop,o.order_id,o.code||'未填编码:'+o.title+':'+o.spec]))throw new Error('订单明细标识与商家编码不一致');
 if(!releaseStaged){if(await d.prepare("SELECT 1 FROM import_conflict_groups WHERE scope=? AND order_key=? AND status='pending'").bind(scope,o.key).first()){if(force)throw Error('请先在导入冲突暂存区核对该商品');return;}ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM import_conflict_groups WHERE scope=? AND order_key=? AND status='pending') THEN json('该商品刚被暂存为冲突，请刷新后核对') ELSE 1 END`).bind(scope,rid,scope,o.key));}
 if(o.shipped_at!=null&&(o.shipped_at<o.order_time||o.shipped_at>now+60000)||o.source_updated_at!=null&&o.source_updated_at>now+60000)throw new Error('发货时间或更新时间无效');
 if(await d.prepare('SELECT 1 FROM work_order_exclusions WHERE scope=? AND shop=? AND order_id=?').bind(scope,o.shop,o.order_id).first())return;
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM work_order_exclusions WHERE scope=? AND shop=? AND order_id=?) THEN json('该订单已标记工单定制，请重新导入以跳过') ELSE 1 END`).bind(scope,rid,scope,o.shop,o.order_id));
 const old=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,o.key).first<OrderLine>();
 o.source_details=validateSource(raw,old??undefined,confirmSourceShipment);
 const detail=sourceDetails(o);
 const duplicate=await d.prepare("SELECT shop FROM orders WHERE scope=? AND order_id=? AND shop<>? AND (?=1 OR source_details<>'') LIMIT 1").bind(scope,o.order_id,o.shop,detail?1:0).first<{shop:string}>();
 if(duplicate)throw Error('订单 '+o.order_id+' 已在店铺 '+duplicate.shop+' 导入，请关联原店铺，避免重复扣库存');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM orders WHERE scope=? AND order_id=? AND shop<>? AND (?=1 OR source_details<>'')) THEN json('跨来源订单已存在，请关联原店铺') ELSE 1 END`).bind(scope,rid,scope,o.order_id,o.shop,detail?1:0));
 if(detail){
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM order_source_shops WHERE scope=? AND source='xiaohongshu' AND source_shop=? AND (shop<>? OR platform<>?)) THEN json('小红书店铺关联已变化，请重新上传') ELSE 1 END`).bind(scope,rid,scope,detail.shop_name,o.shop,o.platform));
  ss.push(d.prepare(`INSERT INTO order_source_shops(scope,source,source_shop,platform,shop) SELECT ?,'xiaohongshu',?,?,? WHERE ${guard} ON CONFLICT(scope,source,source_shop) DO NOTHING`).bind(scope,detail.shop_name,o.platform,o.shop,scope,rid));
 }
 if(old&&old.platform!==o.platform)throw new Error('同店铺编码和订单号的平台发生变化，请核对ERP店铺编码与平台，原订单和库存保持不变');
 o.buyer_remark??=old?.buyer_remark??'';o.seller_remark??=old?.seller_remark??'';o.remarks_available??=old?.remarks_available??0;
 const decision=force?'apply':importDecision(old??undefined,o);if(decision==='ignore')return;
 if(old)guardOrder(d,ss,scope,old,rid,guard);
 else ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=?) THEN json('订单已由另一批次录入，请刷新重试') ELSE 1 END`).bind(scope,rid,scope,o.key));
 if(decision==='conflict'){
  ss.push(d.prepare(`INSERT INTO order_conflicts(scope,order_key,payload,reason,fingerprint,created_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,order_key) DO UPDATE SET payload=excluded.payload,reason=excluded.reason,fingerprint=excluded.fingerprint,created_at=excluded.created_at`).bind(scope,o.key,JSON.stringify(o),'本次数据与已保存订单不同，缺少可确认先后顺序的更新时间；已保留原订单和库存。',orderFingerprint(old!),now,scope,rid));return;
 }
 appendOrderFinance(d,scope,o,now,rid,ss,guard);
 const execution=(detail?.shipment_confirmed||releaseStaged&&confirmSourceShipment)&&o.shipped_at&&!isValid(o.status)?{...o,status:'已发货'}:o;
 const wholePrint=await appendPrintingImport(d,scope,execution,old??undefined,now,rid,ss,guard);
 const supply=wholePrint?{handled:false,cost:undefined}:await appendSupplyImport(d,ss,scope,execution,old??undefined,now,rid,guard,ignoreCutoff);
 const digitCost=wholePrint?null:supply.handled?supply.cost:await appendDigitImport(d,ss,scope,execution,old??undefined,now,rid,guard,ignoreCutoff);
 const testImport=ignoreCutoff&&isValid(o.status);
 const shipped=Math.max(old?.shipped_qty??0,isValid(execution.status)?o.quantity:0),shipAt=o.shipped_at??old?.shipped_at??null,stockAt=shipAt??o.order_time;
 const snapshot=wholePrint?null:old?.unit_cost_snapshot??(shipped&&digitCost!==undefined?digitCost:shipped?(await d.prepare(costSql).bind(scope,o.code).first<{value:number|null}>())?.value:null)??null;
 const review=(sourceNeedsReview(o)&&(!old||sourceDetails(old)?.after_sale!==detail?.after_sale||sourceDetails(old)?.status!==detail?.status))||old?.review===1||!!(old?.shipped_qty&&((!isValid(o.status)&&old.status!==o.status)||o.quantity<old.quantity))?1:0;
 ss.push(d.prepare(`INSERT INTO orders(scope,key,order_id,shop,platform,code,title,spec,quantity,status,order_time,amount,cost,deducted_qty,review,reset,batch_id,updated_at,shipped_at,source_updated_at,shipped_qty,unit_cost_snapshot,buyer_remark,seller_remark,remarks_available)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT CASE WHEN stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0) AND quantity IS NOT NULL AND (?=1 OR count_at<?) THEN ? ELSE 0 END FROM products WHERE scope=? AND code=?),0),?,0,?,?,?,?,?,?,?,?,?
 WHERE ${guard}
 ON CONFLICT(scope,key) DO UPDATE SET title=excluded.title,spec=excluded.spec,buyer_remark=excluded.buyer_remark,seller_remark=excluded.seller_remark,remarks_available=excluded.remarks_available,quantity=excluded.quantity,status=excluded.status,order_time=excluded.order_time,amount=excluded.amount,cost=excluded.cost,reset=0,batch_id=excluded.batch_id,updated_at=excluded.updated_at,review=excluded.review,shipped_at=excluded.shipped_at,source_updated_at=COALESCE(excluded.source_updated_at,orders.source_updated_at),shipped_qty=excluded.shipped_qty,unit_cost_snapshot=COALESCE(orders.unit_cost_snapshot,excluded.unit_cost_snapshot),deducted_qty=MAX(orders.deducted_qty,excluded.deducted_qty)`)
 .bind(scope,o.key,o.order_id,o.shop,o.platform,o.code,o.title,o.spec,o.quantity,o.status,o.order_time,o.amount??old?.amount??null,o.cost??old?.cost??null,testImport?1:0,stockAt,shipped,scope,o.code,review,batch,now,shipAt,o.source_updated_at??null,shipped,snapshot,o.buyer_remark,o.seller_remark,Number(o.remarks_available),scope,rid));
 ss.push(d.prepare(`UPDATE orders SET source_details=? WHERE scope=? AND key=? AND ${guard}`).bind(o.source_details,scope,o.key,scope,rid));
 if(wholePrint)ss.push(d.prepare(`UPDATE orders SET deducted_qty=0,reset=1,unit_cost_snapshot=NULL WHERE scope=? AND key=? AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=orders.scope AND j.shop=orders.shop AND j.order_id=orders.order_id AND j.accounting_mode='sku') AND ${guard}`).bind(scope,o.key,scope,rid));
 // A print line has its own future cost basis; neither ERP cost nor the
 // finished-stock cost snapshot is a confirmed printing cost.
 ss.push(d.prepare(`UPDATE orders SET unit_cost_snapshot=NULL WHERE scope=? AND key=? AND EXISTS(SELECT 1 FROM digit_fulfillments f WHERE f.scope=orders.scope AND f.order_key=orders.key AND f.status='print') AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=orders.scope AND j.shop=orders.shop AND j.order_id=orders.order_id AND j.accounting_mode='sku') AND ${guard}`).bind(scope,o.key,scope,rid));
 if(old&&!testImport&&(old.shipped_at??old.order_time)!==stockAt)appendShipmentRebase(d,ss,scope,o.key,stockAt,shipped,now,rid,guard);
 // A later accepted update must not strand a pending conflict with a stale fingerprint.
 const saved={...o,amount:o.amount??old?.amount??null,cost:o.cost??old?.cost??null,shipped_at:shipAt,source_updated_at:o.source_updated_at??old?.source_updated_at??null,shipped_qty:shipped,cutoff_ack_at:old?.cutoff_ack_at??null};
 ss.push(d.prepare(`UPDATE order_conflicts SET fingerprint=? WHERE scope=? AND order_key=? AND ${guard}`).bind(orderFingerprint(saved),scope,o.key,scope,rid));
}
export async function appendOrderReview(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string,v:Validators){
 const key=v.str(b.key,1000),o=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,key).first<OrderLine>();
 if(!o||v.str(b.fingerprint,12000)!==orderFingerprint(o))throw new Error('订单已变化，请刷新后核对');
 guardOrder(d,ss,scope,o,rid,guard);
 const audit=(note:string)=>ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'order','订单核对',0,?,?,?,'份' WHERE ${guard}`).bind(scope,crypto.randomUUID(),o.code,note,now,key,scope,rid));
 if(b.mode==='accept'||b.mode==='keep'){
  const c=await d.prepare('SELECT * FROM order_conflicts WHERE scope=? AND order_key=?').bind(scope,key).first<OrderConflict>();
  if(!c||c.created_at!==b.conflict_at||c.payload!==b.conflict_payload||c.fingerprint!==orderFingerprint(o))throw new Error('待核对数据已更新，请刷新');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM order_conflicts WHERE scope=? AND order_key=? AND payload=? AND created_at=?) THEN json('待核对数据已更新，请刷新') ELSE 1 END`).bind(scope,rid,scope,key,c.payload,c.created_at));
  if(b.mode==='accept')await appendOrderImport(JSON.parse(c.payload),d,scope,now,rid,'人工核对',ss,guard,v,true);
  ss.push(d.prepare(`DELETE FROM order_conflicts WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,key,scope,rid));
  audit((b.mode==='accept'?'采用本次订单数据':'保留原订单数据')+'；原数据 '+orderFingerprint(o)+'；待核对数据 '+c.payload);return;
 }
 if(b.mode==='source_shipment'){
  const detail=sourceDetails(o);if(!detail||isValid(o.status)||!o.shipped_at||detail.shipment_confirmed)throw Error('这条订单没有待确认的历史出库');
  if(await d.prepare('SELECT 1 FROM order_conflicts WHERE scope=? AND order_key=?').bind(scope,key).first())throw Error('请先处理导入数据冲突');
  await appendOrderImport(o,d,scope,now,rid,'人工确认小红书出库',ss,guard,v,true,false,true);
  audit('确认小红书已关闭/取消订单确实发货，按实际发货及盘点截止时间记录出库；不自动回补退货。');return;
 }
 if(b.mode==='included'){
  const r=await d.prepare(`SELECT MAX(at) AS value FROM (SELECT count_at AS at FROM products WHERE scope=? AND code=? AND stock_mode='direct' AND tracking_enabled=1 AND quantity IS NOT NULL UNION ALL SELECT s.count_at FROM order_effective_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code JOIN products p ON p.scope=r.scope AND p.code=r.sales_code WHERE r.scope=? AND r.order_key=? AND s.archived=0 AND p.tracking_enabled=1 AND s.quantity IS NOT NULL) WHERE at>=?`).bind(scope,o.code,scope,o.key,o.order_time).first<{value:number|null}>();
  if(r?.value==null||o.shipped_at!=null)throw new Error('没有待确认的跨盘点订单');
  ss.push(d.prepare(`UPDATE orders SET cutoff_ack_at=?,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(r.value,now,scope,key,scope,rid));audit('确认该订单发货已包含在当前盘点结果中，不额外扣库存。');return;
 }
 if(b.mode==='shipment'){
  const at=v.timestamp(b.shipped_at);if(at>now+60000||at<o.order_time)throw new Error('请填写下单之后、当前时间之前的实际发货时间');
  const shipped=o.shipped_qty??(isValid(o.status)?o.quantity:0);if(!shipped)throw new Error('这条订单尚无有效发货数量');
  ss.push(d.prepare(`UPDATE orders SET shipped_at=?,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(at,now,scope,key,scope,rid));
  appendShipmentRebase(d,ss,scope,key,at,shipped,now,rid,guard);audit('补录实际发货时间：'+new Date(at).toISOString()+'；按实物盘点时间校正扣减。');return;
 }
 if(b.mode!=='return')throw new Error('不支持的核对操作');
 if(await d.prepare('SELECT order_key FROM order_conflicts WHERE scope=? AND order_key=?').bind(scope,key).first())throw new Error('请先处理订单数据冲突');
 const note=v.str(b.note,1000);if(!note)throw new Error('请填写核对或退货说明');
 if(Array.isArray(b.items)&&b.items.length&&await d.prepare("SELECT 1 FROM print_jobs j WHERE scope=? AND shop=? AND order_id=? AND (accounting_mode='whole' OR EXISTS(SELECT 1 FROM json_each(j.member_keys) WHERE value=?))").bind(scope,o.shop,o.order_id,o.key).first())throw new Error('整单打印不回补现货库存，请只保存核对说明');
 if(!Array.isArray(b.items)||b.items.length>MAX_RECIPE_STOCKS)throw new Error('退货明细无效');
 const at=v.timestamp(b.at??now);if(at>now+60000||at<o.order_time)throw new Error('退货时间无效');
 const seen=new Set<string>();
 for(const item of b.items){
  const code=v.str(item.code),kind=item.kind;if(!['physical','product'].includes(kind)||seen.has(kind+code))throw new Error('退货实物无效或重复');seen.add(kind+code);
  const n=v.qty(item.quantity,false),table=kind==='physical'?'physical_stocks':'products';
  const stock=await d.prepare(`SELECT quantity,count_at,unit FROM ${table} WHERE scope=? AND code=? ${kind==='physical'?'AND archived=0':"AND stock_mode='direct' AND tracking_enabled=1"}`).bind(scope,code).first<{quantity:number|null;count_at:number|null;unit:string}>();
  if(!stock||stock.quantity==null)throw new Error('退货前请先确认这条实物的库存：'+code);
  const rule=kind==='physical'?await d.prepare('SELECT per_unit,allocated_qty FROM order_effective_rules WHERE scope=? AND order_key=? AND stock_code=?').bind(scope,o.key,code).first<{per_unit:number;allocated_qty:number|null}>():null;
  const max=kind==='physical'&&rule?(rule.allocated_qty??o.shipped_qty??0)*rule.per_unit:(kind==='product'&&code===o.code?o.shipped_qty??0:0);
  const returned=await d.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM order_returns WHERE scope=? AND order_key=? AND kind=? AND code=?').bind(scope,key,kind,code).first<{n:number}>();
  if(n+(returned?.n??0)>max)throw new Error('退货数量超过该订单尚可退回的数量：'+code);
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (?+COALESCE((SELECT SUM(quantity) FROM order_returns WHERE scope=? AND order_key=? AND kind=? AND code=?),0)>? OR NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND quantity IS NOT NULL AND count_at IS ?)) THEN json('退货超出已发数量或库存已变化，请刷新') ELSE 1 END`).bind(scope,rid,n,scope,key,kind,code,max,scope,code,stock.count_at));
  ss.push(d.prepare(`INSERT INTO order_returns(scope,id,order_key,code,kind,quantity,at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),key,code,kind,n,at,scope,rid));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+CASE WHEN count_at<? THEN ? ELSE 0 END,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(at,n,now,scope,code,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,effective_at,reference,unit) SELECT ?,?,?,?,'退货入库',?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,kind,n,'订单 '+o.order_id+'；'+note+(at<=(stock.count_at??0)?'；不晚于盘点截止，数量已包含在盘点中':''),now,at,key,stock.unit,scope,rid));
 }
 ss.push(d.prepare(`UPDATE orders SET review=0,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(now,scope,key,scope,rid));audit(note+(b.items.length?'；已登记实际退货入库。':'；本次无需库存回补。'));
}
