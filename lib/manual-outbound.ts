import {appendEntryRecord} from './inventory-entry-actions';
import {isPrintOnly,type OrderLine,type Product,type StockRule,type PhysicalStock} from './model';

type Item={kind:'product'|'physical';code:string;quantity:number;name?:string;unit?:string};
type Link={entry_id:string;platform:string;shop:string;order_id:string;sales_code:string;quantity:number;unit_cost:number|null;fulfilled_at:number;items:string};
const validQty=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=100000000;
const linkQuery='SELECT * FROM manual_outbound_links WHERE scope=? AND order_key=?';
const productQuery="SELECT p.*,json_extract(f.config,'$.variant.supply_mode') AS supply_mode FROM products p LEFT JOIN product_supply_profiles f ON f.scope=p.scope AND f.code=p.code WHERE p.scope=? AND p.code=?";
const rulesQuery='SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code=? ORDER BY stock_code';

export async function appendManualOutbound(b:Record<string,any>,d:D1Database,scope:string,account:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='manual_outbound'&&b.action!=='manual_outbound_reverse')return false;
 const note=typeof b.note==='string'?b.note.trim():'',operator=typeof b.operator==='string'?b.operator.trim():account;
 if(!note||note.length>1000||!operator||operator.length>100)throw Error('请填写出库用途或撤销原因及经办人');
 const reverse=b.action==='manual_outbound_reverse',at=reverse?now:Number(b.at);
 if(!Number.isSafeInteger(at)||at<946684800000||at>now+60000)throw Error('请填写有效的实际出库时间');
 let linked:{key:string;platform:string;shop:string;orderId:string;sku:string;quantity:number;unitCost:number|null}|undefined;
 let items:Item[]=[],reference='',originalAt=at;
 if(reverse){
  const entry=await d.prepare("SELECT * FROM inventory_entries WHERE scope=? AND id=? AND type='手动出库'").bind(scope,String(b.id??'')).first<{id:string;items:string;order_key:string;reference:string;received_at:number}>();
  if(!entry)throw Error('未找到手动出库单');
  originalAt=entry.received_at;items=JSON.parse(entry.items);reference=entry.id;
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (EXISTS(SELECT 1 FROM inventory_entries WHERE scope=? AND type='撤销手动出库' AND reference=?) OR EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND shipped_qty>0)) THEN json('出库单已撤销或已关联发货订单，请通过退货入库处理') ELSE 1 END`).bind(scope,rid,scope,entry.id,scope,entry.order_key));
  ss.push(d.prepare(`DELETE FROM manual_outbound_links WHERE scope=? AND entry_id=? AND ${guard}`).bind(scope,entry.id,scope,rid));
 }else if(b.order){
  const {shop,platform,sku,quantity}=b.order;
  const orderId=typeof b.order.orderId==='string'?b.order.orderId.trim():'';
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(orderId)||typeof shop!=='string'||!shop.trim()||shop.length>160||typeof platform!=='string'||platform.length>30||typeof sku!=='string'||!validQty(quantity))throw Error('请选择订单导入使用的店铺和销售SKU，填写订单号及销售数量');
  const key=JSON.stringify([shop,orderId,sku]);
  if(!await d.prepare('SELECT 1 FROM shop_configs WHERE scope=? AND platform=? AND code=? AND enabled=1').bind(scope,platform,shop).first())throw Error('请选择启用的订单店铺');
  if(await d.prepare('SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=?').bind(scope,shop,orderId).first())throw Error('该订单已有打印记录，请先核对出库方式');
  if(await d.prepare("SELECT 1 FROM orders WHERE scope=? AND order_id=? AND code=? AND (shop=? OR ? IN ('XHS','小红书','xiaohongshu','RED')) AND (shipped_qty>0 OR deducted_qty>0 OR shipped_at IS NOT NULL)").bind(scope,orderId,sku,shop,platform).first())throw Error('这笔订单商品已有发货记录，请核对原订单，避免重复出库');
  const product=await d.prepare(productQuery).bind(scope,sku).first<Product>();
  if(!product||isPrintOnly(product)||product.tracking_enabled!==1)throw Error('请选择已启用库存跟踪的现货销售SKU');
  const rules=(await d.prepare(rulesQuery).bind(scope,sku).all<StockRule>()).results;
  if(product.stock_mode==='recipe'){
   if(!rules.length||product.recipe_at==null||product.recipe_at>at||product.supply_mode==='现货优先（按条件）'||await d.prepare('SELECT 1 FROM stock_rules r JOIN digit_stock_variants v ON v.scope=r.scope AND v.base_code=r.stock_code WHERE r.scope=? AND r.sales_code=?').bind(scope,sku).first())throw Error('此SKU需要按订单备注确定实际库存，请通过订单导入处理');
   items=rules.map(r=>({kind:'physical',code:r.stock_code,quantity:r.per_unit*quantity}));
  }else items=[{kind:'product',code:sku,quantity}];
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (EXISTS(SELECT 1 FROM manual_outbound_links WHERE scope=? AND order_id=? AND sales_code=? AND (shop=? OR lower(?) IN ('xhs','小红书','xiaohongshu','red'))) OR EXISTS(SELECT 1 FROM orders WHERE scope=? AND order_id=? AND code=? AND (shop=? OR lower(?) IN ('xhs','小红书','xiaohongshu','red')) AND (shipped_qty>0 OR deducted_qty>0 OR shipped_at IS NOT NULL)) OR NOT EXISTS(SELECT 1 FROM products WHERE scope=? AND code=? AND updated_at=?)) THEN json('订单已出库、已发货或商品资料已变化，请刷新核对') ELSE 1 END`).bind(scope,rid,scope,orderId,sku,shop,platform,scope,orderId,sku,shop,platform,scope,sku,product.updated_at));
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (EXISTS(SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=?) OR NOT EXISTS(SELECT 1 FROM shop_configs WHERE scope=? AND platform=? AND code=? AND enabled=1) OR COALESCE((SELECT json_group_array(json_array(stock_code,per_unit)) FROM (SELECT stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code=? ORDER BY stock_code)),'[]')<>?) THEN json('店铺或库存关联已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,shop,orderId,scope,platform,shop,scope,sku,JSON.stringify(rules.map(r=>[r.stock_code,r.per_unit]))));
  linked={key,platform,shop,orderId,sku,quantity,unitCost:product.cost};
  reference=[shop,orderId,sku].join(' · ');
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
  if(!reverse&&row.quantity<quantity)throw Error('库存不足：'+code);
  const delta=reverse?quantity:-quantity;
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND ${eligible} AND count_at=? AND unit=? AND quantity IS NOT NULL AND quantity+?>=0) THEN json('库存资料已变化或数量不足，请刷新') ELSE 1 END`).bind(scope,rid,scope,code,row.count_at,row.unit,delta));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(delta,now,scope,code,scope,rid));
  const type=reverse?'撤销手动出库':'手动出库';
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,effective_at,reference,unit) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,kind,type,delta,note+' · '+operator,now,at,linked?.key??(reference||rid),row.unit,scope,rid));
  saved.push({kind,code,name:row.name,unit:row.unit,quantity});
  if(row.cost==null)knownCost=false;else componentCost+=row.cost*quantity;
 }
 if(linked){
  const l=linked;
  ss.push(d.prepare(`INSERT INTO manual_outbound_links SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,l.key,rid,l.platform,l.shop,l.orderId,l.sku,l.quantity,l.unitCost??(knownCost?componentCost/l.quantity:null),at,JSON.stringify(saved),scope,rid));
 }
 appendEntryRecord(d,ss,scope,rid,guard,reverse?'撤销手动出库':'手动出库',reference,linked?.key??'',saved,note,operator+' / '+account,at,now);
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
 const direct=items.find(i=>i.kind==='product');
 if(direct)ss.push(d.prepare(`UPDATE orders SET deducted_qty=?,reset=1 WHERE scope=? AND key=? AND ${guard}`).bind(direct.quantity,scope,o.key,scope,rid));
}
