import {printBasis} from './printing';
import type {OrderLine} from './model';
export type WorkOrderExclusion={shop:string;order_id:string;platform:string;label:string;created_at:number;line_count:number;title:string};
export async function readWorkOrderExclusions(d:D1Database,scope:string){return (await d.prepare("SELECT shop,order_id,platform,label,created_at,json_array_length(snapshot,'$.orders') line_count,json_extract(snapshot,'$.orders[0].title') title FROM work_order_exclusions WHERE scope=? ORDER BY created_at DESC").bind(scope).all<WorkOrderExclusion>()).results;}
export async function appendWorkOrderExclusion(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='work_order_exclude')return false;
 if(typeof b.shop!=='string'||typeof b.order_id!=='string'||!b.shop||!b.order_id||b.shop.length>160||b.order_id.length>160)throw new Error('订单标识不正确');
 const args=[scope,b.shop,b.order_id];
 if(await d.prepare('SELECT 1 FROM work_order_exclusions WHERE scope=? AND shop=? AND order_id=?').bind(...args).first())return true;
 const orders=(await d.prepare('SELECT * FROM orders WHERE scope=? AND shop=? AND order_id=? ORDER BY key').bind(...args).all<OrderLine&{updated_at:number;reset:number}>()).results;
 if(!orders.length||printBasis(orders)!==b.basis)throw new Error('整单商品或数量已变化，请刷新后重试');
 const keys=JSON.stringify(orders.map(o=>o.key)),snapshot:Record<string,unknown>={orders},where='scope=? AND order_key IN(SELECT value FROM json_each(?))';
 const detailTables=['order_stocks','order_conflicts','order_returns','digit_fulfillments','digit_fulfillment_rules','order_finance','order_waybills'];
 for(const t of detailTables)snapshot[t]=(await d.prepare('SELECT * FROM '+t+' WHERE '+where).bind(scope,keys).all()).results;
 for(const t of ['print_jobs','print_events','print_stock_corrections','print_rule_matches','shop_order_pricing'])snapshot[t]=(await d.prepare('SELECT * FROM '+t+' WHERE scope=? AND shop=? AND order_id=?').bind(...args).all()).results;
 snapshot.movements=(await d.prepare('SELECT * FROM movements WHERE scope=? AND reference IN(SELECT value FROM json_each(?))').bind(scope,keys).all()).results;
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND ((SELECT COUNT(*) FROM orders WHERE scope=? AND shop=? AND order_id=?)<>? OR EXISTS(SELECT 1 FROM work_order_exclusions WHERE scope=? AND shop=? AND order_id=?)) THEN json('订单归属已变化，请刷新') ELSE 1 END`).bind(scope,rid,...args,orders.length,...args));
 for(const o of orders)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=? AND deducted_qty=? AND reset=?) THEN json('订单已更新，请刷新') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at,o.deducted_qty??0,o.reset));
 // Undo only movements affecting the current count baseline; don't add back
 // shipments already included in a later stocktake, or returned twice.
 const stockRows=snapshot.order_stocks as {stock_code:string;deducted_qty:number;reset:number;order_key:string}[];
 const returns=snapshot.order_returns as {code:string;kind:string;quantity:number;at:number}[];
 const corrections=snapshot.print_stock_corrections as {code:string;kind:string;quantity:number;shipment_at:number;returned_at:number}[];
 for(const j of snapshot.print_jobs as {updated_at:number}[])ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=? AND updated_at=?) THEN json('打印记录已更新，请刷新') ELSE 1 END`).bind(scope,rid,...args,j.updated_at));
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (SELECT COUNT(*) FROM order_returns WHERE ${where})<>? THEN json('退货记录已更新，请刷新') ELSE 1 END`).bind(scope,rid,scope,keys,returns.length));
 const quantities=new Map<string,{kind:string;code:string;quantity:number}>();
 const add=(kind:string,code:string,n:number)=>{const k=JSON.stringify([kind,code]),a=quantities.get(k)??{kind,code,quantity:0};a.quantity+=n;quantities.set(k,a);};
 for(const r of stockRows)if(!r.reset)add('physical',r.stock_code,r.deducted_qty);
 for(const o of orders)if(!o.reset)add('product',o.code,o.deducted_qty??0);
 for(const r of returns)add(r.kind,r.code,0);
 for(const r of corrections)add(r.kind,r.code,0);
 for(const q of quantities.values()){
  const table=q.kind==='physical'?'physical_stocks':'products',s=await d.prepare('SELECT quantity,count_at,updated_at,unit FROM '+table+' WHERE scope=? AND code=?').bind(scope,q.code).first<{quantity:number|null;count_at:number|null;updated_at:number;unit:string}>();
  if(!s||s.quantity==null)continue;
  const delta=q.quantity-returns.filter(r=>r.kind===q.kind&&r.code===q.code&&r.at>=(s.count_at??0)).reduce((n,r)=>n+r.quantity,0)-corrections.filter(r=>r.kind===q.kind&&r.code===q.code&&r.shipment_at<(s.count_at??0)&&r.returned_at>=(s.count_at??0)).reduce((n,r)=>n+r.quantity,0);
  if(!delta)continue;
  if(s.quantity+delta<0)throw new Error('这单已有退货且库存后续发生变化，请先核对库存：'+q.code);
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND quantity IS ? AND count_at IS ? AND updated_at=?) THEN json('库存已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,q.code,s.quantity,s.count_at,s.updated_at));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(delta,now,scope,q.code,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,?,'工单定制校正',?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),q.code,q.kind,delta,'整单 '+b.order_id+' 标记工单定制，移出仓库核算',now,rid,s.unit,scope,rid));
 }
 ss.push(d.prepare(`INSERT INTO work_order_exclusions(scope,shop,order_id,platform,snapshot,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(...args,orders[0].platform,JSON.stringify(snapshot),now,scope,rid));
 ss.push(d.prepare(`UPDATE import_conflict_groups SET status='ignored',resolved_at=? WHERE scope=? AND shop=? AND order_id=? AND status='pending' AND ${guard}`).bind(now,...args,scope,rid));
 for(const t of detailTables)ss.push(d.prepare(`DELETE FROM ${t} WHERE ${where} AND ${guard}`).bind(scope,keys,scope,rid));
 for(const t of ['print_rule_matches','print_events','print_stock_corrections','print_jobs','shop_order_pricing'])ss.push(d.prepare(`DELETE FROM ${t} WHERE scope=? AND shop=? AND order_id=? AND ${guard}`).bind(...args,scope,rid));
 // The archived snapshot preserves the originals; removing their operational
 // rows keeps every existing warehouse/printing/freight/finance query consistent.
 ss.push(d.prepare(`DELETE FROM movements WHERE scope=? AND reference IN(SELECT value FROM json_each(?)) AND ${guard}`).bind(scope,keys,scope,rid));
 ss.push(d.prepare(`DELETE FROM orders WHERE scope=? AND shop=? AND order_id=? AND ${guard}`).bind(...args,scope,rid));
 ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'order','工单定制',0,?,?,?,'份' WHERE ${guard}`).bind(scope,crypto.randomUUID(),orders[0].code,'整单 '+b.shop+' / '+b.order_id+' 已忽略；保留 '+orders.length+' 项原始商品记录',now,rid,scope,rid));
 return true;
}
