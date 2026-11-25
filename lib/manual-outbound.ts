import {appendEntryRecord} from './inventory-entry-actions';
import {isPrintOnly,type OrderLine,type Product,type StockRule,type PhysicalStock} from './model';

export type OutboundItem={kind:'product'|'physical';code:string;quantity:number;name?:string;unit?:string};
type Item=OutboundItem;
type Link={entry_id:string;platform:string;shop:string;order_id:string;sales_code:string;quantity:number;unit_cost:number|null;fulfilled_at:number;items:string};
const validQty=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=100000000;
const linkQuery='SELECT * FROM manual_outbound_links WHERE scope=? AND order_key=?';
const productQuery="SELECT p.*,json_extract(f.config,'$.variant.supply_mode') AS supply_mode FROM products p LEFT JOIN product_supply_profiles f ON f.scope=p.scope AND f.code=p.code WHERE p.scope=? AND p.code=?";
const rulesQuery='SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code=? ORDER BY stock_code';
const orderQuery='SELECT * FROM orders WHERE scope=? AND key=?';
type SavedOrder=OrderLine&{updated_at:number};

async function planItems(d:D1Database,scope:string,sku:string,quantity:number,at:number,rid:string,guard:string,ss:D1PreparedStatement[]){
 const product=await d.prepare(productQuery).bind(scope,sku).first<Product>();
 if(!product||isPrintOnly(product)||product.tracking_enabled!==1)throw Error('请选择已启用库存跟踪的现货SKU：'+sku);
 const rules=(await d.prepare(rulesQuery).bind(scope,sku).all<StockRule>()).results;
 if(product.stock_mode==='recipe'&&(!rules.length||product.recipe_at==null||product.recipe_at>at||product.supply_mode==='现货优先（按条件）'||await d.prepare('SELECT 1 FROM stock_rules r JOIN digit_stock_variants v ON v.scope=r.scope AND v.base_code=r.stock_code WHERE r.scope=? AND r.sales_code=?').bind(scope,sku).first()))throw Error('此SKU需要按备注确认库存版面，暂不能用固定规格手动出库：'+sku);
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (NOT EXISTS(SELECT 1 FROM products WHERE scope=? AND code=? AND updated_at=?) OR (SELECT json_group_array(json_array(stock_code,per_unit)) FROM (SELECT stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code=? ORDER BY stock_code))<>?) THEN json('商品或扣减规则已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,sku,product.updated_at,scope,sku,JSON.stringify(rules.map(r=>[r.stock_code,r.per_unit]))));
 const items:Item[]=product.stock_mode==='recipe'?rules.map(r=>({kind:'physical',code:r.stock_code,quantity:r.per_unit*quantity})):[{kind:'product',code:sku,quantity}];
 return {items,cost:product.cost};
}

async function restoreWrongDeduction(d:D1Database,scope:string,o:SavedOrder,rid:string,now:number,ss:D1PreparedStatement[],guard:string){
 const hasReturn='SELECT 1 FROM order_returns WHERE scope=? AND order_key=?';
 if(await d.prepare(hasReturn).bind(scope,o.key).first())throw Error('原订单已有退货登记，请先核对实际出入库记录');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=?) OR EXISTS(${hasReturn})) THEN json('订单或退货记录已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at,scope,o.key));
 const parts=(await d.prepare('SELECT stock_code,deducted_qty FROM order_stocks WHERE scope=? AND order_key=? AND deducted_qty>0').bind(scope,o.key).all<{stock_code:string;deducted_qty:number}>()).results;
 const items:Item[]=parts.map(r=>({kind:'physical',code:r.stock_code,quantity:r.deducted_qty}));
 if(o.deducted_qty)items.push({kind:'product',code:o.code,quantity:o.deducted_qty});
 const restored=new Map<string,number>();
 for(const item of items){
  const table=item.kind==='physical'?'physical_stocks':'products';
  const stock=await d.prepare(`SELECT quantity,count_at,unit FROM ${table} WHERE scope=? AND code=?`).bind(scope,item.code).first<PhysicalStock>();
  if(stock?.quantity==null||stock.count_at==null||stock.count_at>=(o.shipped_at??o.order_time))throw Error('原货品盘点与发货时间需要先核对：'+item.code);
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND count_at=? AND quantity IS NOT NULL) THEN json('原货品库存已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,item.code,stock.count_at));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(item.quantity,now,scope,item.code,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,effective_at,reference,unit) SELECT ?,?,?,?,'换款冲回',?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),item.code,item.kind,item.quantity,'换款发货，冲回原订单误扣 · '+o.order_id,now,o.shipped_at??o.order_time,o.key,stock.unit,scope,rid));
  restored.set(item.kind+item.code,item.quantity);
 }
 ss.push(d.prepare(`DELETE FROM order_stocks WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
 ss.push(d.prepare(`DELETE FROM digit_fulfillment_rules WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
 ss.push(d.prepare(`DELETE FROM digit_fulfillments WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
 return restored;
}

export async function appendManualOutbound(b:Record<string,any>,d:D1Database,scope:string,account:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='manual_outbound'&&b.action!=='manual_outbound_reverse')return false;
 const note=typeof b.note==='string'?b.note.trim():'',operator=typeof b.operator==='string'?b.operator.trim():account;
 if(!note||note.length>1000||!operator||operator.length>100)throw Error('请填写出库用途或撤销原因及经办人');
 const replacement=b.action==='manual_outbound'&&b.order?.actual!==undefined;
 const reverse=b.action==='manual_outbound_reverse',at=reverse?now:Number(b.at);
 if(!Number.isSafeInteger(at)||at<946684800000||at>now+60000)throw Error('请填写有效的实际出库时间');
 let linked:{key:string;platform:string;shop:string;orderId:string;sku:string;quantity:number;unitCost:number|null}|undefined;
 let items:Item[]=[],reference='',originalAt=at;
 let correction:SavedOrder|undefined,restored=new Map<string,number>();
 let actualLabel='';
 if(reverse){
  const entry=await d.prepare("SELECT * FROM inventory_entries WHERE scope=? AND id=? AND type IN ('手动出库','换款发货')").bind(scope,String(b.id??'')).first<{id:string;items:string;order_key:string;reference:string;received_at:number}>();
  if(!entry)throw Error('未找到手动出库单');
  originalAt=entry.received_at;items=JSON.parse(entry.items);reference=entry.id;
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (EXISTS(SELECT 1 FROM inventory_entries WHERE scope=? AND type='撤销手动出库' AND reference=?) OR EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND shipped_qty>0)) THEN json('出库单已撤销或已关联发货订单，请通过退货入库处理') ELSE 1 END`).bind(scope,rid,scope,entry.id,scope,entry.order_key));
  ss.push(d.prepare(`DELETE FROM manual_outbound_links WHERE scope=? AND entry_id=? AND ${guard}`).bind(scope,entry.id,scope,rid));
 }else if(b.order){
  const {shop,platform,sku,quantity}=b.order;
  const orderId=typeof b.order.orderId==='string'?b.order.orderId.trim():'';
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(orderId)||typeof shop!=='string'||!shop.trim()||shop.length>160||typeof platform!=='string'||platform.length>30||typeof sku!=='string'||!validQty(quantity))throw Error('请选择订单导入使用的店铺和销售SKU，填写订单号及销售数量');
  const key=JSON.stringify([shop,orderId,sku]);
  const existing=await d.prepare(orderQuery).bind(scope,key).first<SavedOrder>();
  if(existing&&existing.platform!==platform)throw Error('店铺平台与订单不一致');
  if(!existing&&!await d.prepare('SELECT 1 FROM shop_configs WHERE scope=? AND platform=? AND code=? AND enabled=1').bind(scope,platform,shop).first())throw Error('请选择启用的订单店铺');
  const printed='SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=?';
  if(await d.prepare(printed).bind(scope,shop,orderId).first())throw Error('该订单已有打印记录，请先核对出库方式');
  const shipment="SELECT 1 FROM orders WHERE scope=? AND order_id=? AND code=? AND (shop=? OR lower(?) IN ('xhs','小红书','xiaohongshu','red')) AND (shipped_qty>0 OR deducted_qty>0 OR shipped_at IS NOT NULL) AND key<>?";
  const shipmentArgs=[scope,orderId,sku,shop,platform,replacement?key:''] as const;
  if(await d.prepare(shipment).bind(...shipmentArgs).first())throw Error('这笔订单商品已有发货记录，请核对原订单，避免重复出库');
  const pending="SELECT 1 FROM import_conflict_groups WHERE scope=? AND order_key=? AND status='pending' UNION ALL SELECT 1 FROM order_conflicts WHERE scope=? AND order_key=?";
  if(await d.prepare(pending).bind(scope,key,scope,key).first())throw Error('请先处理这条订单的导入冲突');
  const duplicate="SELECT 1 FROM manual_outbound_links WHERE scope=? AND order_id=? AND sales_code=? AND (shop=? OR lower(platform) IN ('xhs','小红书','xiaohongshu','red') OR lower(?) IN ('xhs','小红书','xiaohongshu','red'))";
  if(await d.prepare(duplicate).bind(scope,orderId,sku,shop,platform).first())throw Error('此订单明细已登记出库，请查看原出库记录');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (EXISTS(${duplicate}) OR EXISTS(${shipment}) OR EXISTS(${printed}) OR EXISTS(${pending}) OR (SELECT updated_at FROM orders WHERE scope=? AND key=?) IS NOT ?) THEN json('订单已变化，请刷新核对') ELSE 1 END`).bind(scope,rid,scope,orderId,sku,shop,platform,...shipmentArgs,scope,shop,orderId,scope,key,scope,key,scope,key,existing?.updated_at??null));
  const plan:unknown=replacement?b.order.actual:[{sku,quantity}];
  if(!Array.isArray(plan)||!plan.length||plan.length>20||plan.some(x=>!x||typeof x.sku!=='string'||!x.sku||!validQty(x.quantity))||new Set(plan.map(x=>x.sku)).size!==plan.length||plan.reduce((n,x)=>n+x.quantity,0)!==quantity)throw Error('实际发货各款份数相加须等于原订单数量，同款请合并填写');
  if(existing&&replacement){
   if(existing.quantity!==quantity||!['未发货','待发货','已付款','已发货','已完成'].includes(existing.status)||at<existing.order_time||existing.shipped_qty&&existing.shipped_qty!==quantity)throw Error('订单状态、销售数量或实际发货时间需要先核对');
   correction=existing;
   restored=await restoreWrongDeduction(d,scope,existing,rid,now,ss,guard);
  }
  const combined=new Map<string,Item>();
  let cost=0,allFixed=true;
  for(const part of plan){
   const result=await planItems(d,scope,part.sku,part.quantity,at,rid,guard,ss);
   if(result.cost==null)allFixed=false;else cost+=result.cost*part.quantity;
   for(const item of result.items){
    const id=item.kind+item.code,prior=combined.get(id);
    combined.set(id,{...item,quantity:(prior?.quantity??0)+item.quantity});
   }
  }
  items=[...combined.values()];
  linked={key,platform,shop,orderId,sku,quantity,unitCost:allFixed?cost/quantity:null};
  actualLabel=replacement?plan.map(x=>x.sku+' × '+x.quantity+'份').join('、'):'';
  reference=[shop,orderId,sku,...(actualLabel?['实发 '+actualLabel]:[])].join(' · ');
 }else items=b.items;
 if(!Array.isArray(items)||!items.length||items.length>150)throw Error('请选择1～150项仓库货品');
 const saved:Item[]=[],seen=new Set<string>();
 let componentCost=0,knownCost=true;
 for(const item of items){
  const {kind,code,quantity}=item;
  if(!['physical','product'].includes(kind)||typeof code!=='string'||!validQty(quantity)||seen.has(kind+code))throw Error('货品重复或数量无效');
  seen.add(kind+code);
  const table=kind==='physical'?'physical_stocks':'products';
  const eligible=kind==='physical'?'archived=0':"stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0) AND NOT EXISTS(SELECT 1 FROM product_supply_profiles f WHERE f.scope=products.scope AND f.code=products.code AND json_extract(f.config,'$.variant.supply_mode') IN ('打印定制','定制订单'))";
  const row=await d.prepare(`SELECT * FROM ${table} WHERE scope=? AND code=? AND ${eligible}`).bind(scope,code).first<PhysicalStock>();
  if(!row||row.quantity==null||row.count_at==null||row.count_at>=originalAt)throw Error('请核对最近盘点与实际出库时间：'+code);
  if(!reverse&&row.quantity+(restored.get(kind+code)??0)<quantity)throw Error('库存不足：'+code);
  const delta=reverse?quantity:-quantity;
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND ${eligible} AND count_at=? AND unit=? AND quantity IS NOT NULL AND quantity+?>=0) THEN json('库存资料已变化或数量不足，请刷新') ELSE 1 END`).bind(scope,rid,scope,code,row.count_at,row.unit,delta));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(delta,now,scope,code,scope,rid));
  const type=reverse?'撤销手动出库':replacement?'换款发货':'手动出库';
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,effective_at,reference,unit) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,kind,type,delta,note+' · '+operator,now,at,linked?.key??(reference||rid),row.unit,scope,rid));
  saved.push({kind,code,name:row.name,unit:row.unit,quantity});
  if(row.cost==null)knownCost=false;else componentCost+=row.cost*quantity;
 }
 if(linked){
  const l=linked;
  const cost=l.unitCost??(knownCost?componentCost/l.quantity:null);
  ss.push(d.prepare(`INSERT INTO manual_outbound_links SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,l.key,rid,l.platform,l.shop,l.orderId,l.sku,l.quantity,cost,at,JSON.stringify(saved),scope,rid));
  if(correction){
   const imported={...correction,status:['未发货','待发货','已付款'].includes(correction.status)?'已发货':correction.status};
   ss.push(d.prepare(`UPDATE orders SET status=?,shipped_qty=?,shipped_at=?,unit_cost_snapshot=?,deducted_qty=0,reset=1,review=0,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(imported.status,l.quantity,at,cost,now,scope,l.key,scope,rid));
   attachOutboundHistory(d,scope,imported,{...l,entry_id:rid,order_id:l.orderId,sales_code:l.sku,unit_cost:cost,fulfilled_at:at,items:JSON.stringify(saved)},now,rid,ss,guard);
  }
 }
 appendEntryRecord(d,ss,scope,rid,guard,reverse?'撤销手动出库':replacement?'换款发货':'手动出库',reference,linked?.key??'',saved,note,operator+' / '+account,at,now);
 return true;
}

export async function readOutboundLink(d:D1Database,scope:string,o:OrderLine,rid:string,ss:D1PreparedStatement[],guard:string){
 const linked=await d.prepare(linkQuery).bind(scope,o.key).first<Link>();
 const crossShop="SELECT 1 FROM manual_outbound_links WHERE scope=? AND order_id=? AND sales_code=? AND shop<>? AND (lower(platform) IN ('xhs','小红书','xiaohongshu','red') OR lower(?) IN ('xhs','小红书','xiaohongshu','red'))";
 const args=[scope,o.order_id,o.code,o.shop,o.platform] as const;
 if(await d.prepare(crossShop).bind(...args).first())throw Error('订单 '+o.order_id+' 的 '+o.code+' 已在另一店铺手动出库，请选择原出库店铺');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (EXISTS(${crossShop}) OR (SELECT entry_id FROM manual_outbound_links WHERE scope=? AND order_key=?) IS NOT ?) THEN json('手动出库记录已变化，请重新导入') ELSE 1 END`).bind(scope,rid,...args,scope,o.key,linked?.entry_id??null));
 return linked;
}

export function attachOutboundHistory(d:D1Database,scope:string,o:OrderLine,link:Link,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 const items=JSON.parse(link.items) as Item[];
 for(const i of items.filter(i=>i.kind==='physical')){
  ss.push(d.prepare(`INSERT INTO order_stocks(scope,order_key,sales_code,stock_code,deducted_qty,reset,updated_at) SELECT ?,?,?,?,?,1,? WHERE ${guard} ON CONFLICT(scope,order_key,stock_code) DO NOTHING`).bind(scope,o.key,o.code,i.code,i.quantity,now,scope,rid));
 }
 const direct=items.find(i=>i.kind==='product'&&i.code===o.code);
 if(direct)ss.push(d.prepare(`UPDATE orders SET deducted_qty=?,reset=1 WHERE scope=? AND key=? AND ${guard}`).bind(direct.quantity,scope,o.key,scope,rid));
}
