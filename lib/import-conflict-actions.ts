import {appendOrderImport} from './order-actions';
import {ignoredOrderCode,IGNORED_ORDER_REASON,readImportIgnoreRules} from './order-scope';
import {orderFingerprint} from './order-policy';
import {appendAutoPrintAccounting} from './print-accounting';
import {appendShopSnapshots} from './shop-actions';
import type {OrderLine} from './model';
import type {ImportConflictGroup,StagedImportConflict} from './import-conflict-types';
export async function readImportConflicts(d:D1Database,scope:string,b:Record<string,any>){
 const status=b.status==='resolved'?'resolved':'pending',page=Math.max(1,Math.min(100000,Number(b.page)||1));
 const found=await d.batch([d.prepare('SELECT COUNT(*) n FROM import_conflict_groups WHERE scope=? AND status=?').bind(scope,status),d.prepare('SELECT g.*,o.key existing_key,o.status existing_status,o.deducted_qty existing_deducted_qty FROM import_conflict_groups g LEFT JOIN orders o ON o.scope=g.scope AND o.key=g.order_key WHERE g.scope=? AND g.status=? ORDER BY g.created_at DESC,g.id LIMIT 20 OFFSET ?').bind(scope,status,(page-1)*20)]);
 const rows=[];for(const g of found[1].results as StagedImportConflict[]){const old=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,g.order_key).first<OrderLine>();rows.push({...g,current_fingerprint:old?orderFingerprint(old):'',current_order:old??null});}
 return {rows,total:(found[0].results[0] as {n:number}).n,page};
}
export async function appendImportConflict(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string,v:Parameters<typeof appendOrderImport>[8]){
 if(b.action==='import_conflict_stage'){
  const group=b.group as ImportConflictGroup,filename=v.str(b.filename,300);if(!group||!filename||!Array.isArray(group.rows)||group.rows.length<2||group.rows.length>2000)throw Error('冲突明细组无效');
  if(!group.order_id||!group.code||group.key!==JSON.stringify([...(group.shop.trim()?[]:[group.rows[0]?.line.platform]),group.shop.trim(),group.order_id,group.code]))throw Error('冲突订单编码无效');
  if(group.rows.some(r=>!r.line||r.line.key!==group.key||r.line.shop!==group.shop||r.line.code!==group.code||r.line.order_id!==group.order_id||!Number.isSafeInteger(r.row)||r.row<1))throw Error('冲突明细不属于同一商品');
  if(ignoredOrderCode(group.code,await readImportIgnoreRules(d,scope))){ss.push(d.prepare(`INSERT INTO ignored_order_lines(scope,order_key,shop,order_id,code,payload,reason,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,order_key) DO NOTHING`).bind(scope,group.key,group.shop,group.order_id,group.code,JSON.stringify(group),IGNORED_ORDER_REASON,now,scope,rid));return true;}
  const payload=JSON.stringify(group),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload)),id=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
  if(await d.prepare('SELECT 1 FROM import_conflict_groups WHERE scope=? AND id=?').bind(scope,id).first())return true;
  if(await d.prepare('SELECT 1 FROM work_order_exclusions WHERE scope=? AND shop=? AND order_id=?').bind(scope,group.shop,group.order_id).first())return true;
  ss.push(d.prepare(`UPDATE import_conflict_groups SET status='superseded' WHERE scope=? AND order_key=? AND id<>? AND status='pending' AND ${guard}`).bind(scope,group.key,id,scope,rid));
  const old=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,group.key).first<OrderLine>();
  ss.push(d.prepare(`INSERT INTO import_conflict_groups(scope,id,order_key,shop,order_id,code,filename,payload,created_at,old_order) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO NOTHING`).bind(scope,id,group.key,group.shop,group.order_id,group.code,filename,payload,now,old?JSON.stringify(old):'',scope,rid));return true;
 }
 if(b.action!=='import_conflict_resolve')return false;
 const g=await d.prepare("SELECT * FROM import_conflict_groups WHERE scope=? AND id=? AND status='pending'").bind(scope,v.str(b.id,100)).first<StagedImportConflict>();
 if(!g||g.payload!==b.payload)throw Error('冲突明细已更新，请刷新后核对');
 const group=JSON.parse(g.payload) as ImportConflictGroup,selected=group.rows[b.selected];if(!selected)throw Error('请选择作为核对依据的原始明细');
 const note=v.str(b.note,1000);if(!note||b.confirmed!==true)throw Error('请填写核对说明并确认数量、状态和金额');
 const old=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,g.order_key).first<OrderLine>();if((old?orderFingerprint(old):'')!==b.current_fingerprint)throw Error('原订单已变化，请刷新后核对');
 const line:OrderLine={...selected.line,quantity:b.quantity,status:v.str(b.status,40),shipped_at:b.shipped_at==null?null:v.timestamp(b.shipped_at),amount:b.amount,cost:b.cost,refund_amount:b.refund_amount,net_amount:b.net_amount};
 if(!['已发货','已完成','待发货','已关闭','已取消','退款中','退款成功'].includes(line.status))throw Error('请选择有效订单状态');
 if(!line.shop.trim())throw Error('请先在原表补齐店铺编码，再重新上传此冲突明细');
 if(b.actual_shipped===true&&!line.shipped_at)throw Error('确认已实际发货时，请填写真实发货时间');
 if(await d.prepare('SELECT 1 FROM work_order_exclusions WHERE scope=? AND shop=? AND order_id=?').bind(scope,g.shop,g.order_id).first())throw Error('整单已标记工单定制，请保持忽略');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM import_conflict_groups WHERE scope=? AND id=? AND status='pending' AND payload=?) THEN json('冲突明细已处理') ELSE 1 END`).bind(scope,rid,scope,g.id,g.payload));
 ss.push(d.prepare(`UPDATE import_conflict_groups SET status='resolved',resolved_at=?,resolution=? WHERE scope=? AND id=? AND ${guard}`).bind(now,JSON.stringify({line,note,selected:b.selected,actual_shipped:b.actual_shipped===true}),scope,g.id,scope,rid));
 await appendOrderImport(line,d,scope,now,rid,'conflict:'+g.id,ss,guard,v,true,false,b.actual_shipped===true,true);
 await appendAutoPrintAccounting(d,scope,[line],now,rid,ss,guard);appendShopSnapshots(d,scope,ss,now,rid,guard,[line.key]);
 return true;
}
