import {normalizeWaybill,validMonth,cents,type FreightData,type FreightBill,type FreightPeriod,type FreightImport} from './freight-reconciliation';
import type {OrderLine} from './model';
import {billAmount} from './freight-amount';

export async function readFreightData(d:D1Database,scope:string):Promise<FreightData>{
 const r=await d.batch([
  d.prepare('SELECT b.* FROM freight_bills b WHERE b.scope=? AND EXISTS(SELECT 1 FROM order_waybills w JOIN orders o ON o.scope=w.scope AND o.key=w.order_key WHERE w.scope=b.scope AND w.tracking=b.tracking) ORDER BY b.month DESC,b.tracking').bind(scope),
  d.prepare('SELECT month,packing_cents,updated_at FROM freight_periods WHERE scope=? ORDER BY month DESC').bind(scope),
  d.prepare('SELECT * FROM freight_imports WHERE scope=? ORDER BY created_at DESC').bind(scope),
  d.prepare('SELECT fee_cents,updated_at FROM packing_settings WHERE scope=?').bind(scope),
  d.prepare("SELECT DISTINCT shop,order_id FROM import_conflict_groups WHERE scope=? AND status='pending'").bind(scope),
  d.prepare('SELECT DISTINCT shop,order_id FROM ignored_order_lines WHERE scope=?').bind(scope),
 ]);return {ignoredSkuOrders:(r[5].results as {shop:string;order_id:string}[]).map(o=>JSON.stringify([o.shop,o.order_id])),pendingImportOrders:(r[4].results as {shop:string;order_id:string}[]).map(o=>JSON.stringify([o.shop,o.order_id])),freightBills:r[0].results as FreightBill[],freightPeriods:r[1].results as FreightPeriod[],freightImports:r[2].results as FreightImport[],packingSettings:(r[3].results[0] as {fee_cents:number|null;updated_at:number}|undefined)??{fee_cents:null,updated_at:0}};
}
export function financeFields(raw:OrderLine){
 const out:Partial<OrderLine>={};
 if(raw.tracking_numbers!==undefined){if(!Array.isArray(raw.tracking_numbers)||raw.tracking_numbers.length>30||raw.tracking_numbers.some(v=>typeof v!=='string'))throw new Error('订单运单号格式不正确');out.tracking_numbers=[...new Set(raw.tracking_numbers.map(normalizeWaybill))].sort();}
 if(raw.carrier!==undefined){if(typeof raw.carrier!=='string'||raw.carrier.length>100)throw new Error('快递公司格式不正确');out.carrier=raw.carrier.trim();}
 for(const field of ['refund_amount','net_amount'] as const)if(raw[field]!==undefined){if(raw[field]!==null&&(typeof raw[field]!=='number'||!Number.isFinite(raw[field])||raw[field]!<0||raw[field]!>1e8))throw new Error('实收或退款金额不正确');out[field]=raw[field];}
 return out;
}
export function appendOrderFinance(d:D1Database,scope:string,o:OrderLine,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(o.tracking_numbers?.length){
  ss.push(d.prepare(`DELETE FROM order_waybills WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
  for(const tracking of o.tracking_numbers)ss.push(d.prepare(`INSERT INTO order_waybills(scope,order_key,tracking,carrier) SELECT ?,?,?,? WHERE ${guard}`).bind(scope,o.key,tracking,o.carrier??'',scope,rid));
 }
 if(o.refund_amount!=null||o.net_amount!=null)ss.push(d.prepare(`INSERT INTO order_finance(scope,order_key,refund_amount,net_amount,updated_at) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,order_key) DO UPDATE SET refund_amount=COALESCE(excluded.refund_amount,order_finance.refund_amount),net_amount=COALESCE(excluded.net_amount,order_finance.net_amount),updated_at=excluded.updated_at`).bind(scope,o.key,o.refund_amount??null,o.net_amount??null,now,scope,rid));
}
export async function appendFreightAction(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action==='packing_settings'){
  const fee=cents(b.packing_fee,'统一打包费'),old=await d.prepare('SELECT updated_at FROM packing_settings WHERE scope=?').bind(scope).first<{updated_at:number}>();if((old?.updated_at??0)!==b.updated_at)throw new Error('统一打包费已更新，请刷新后重试');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM packing_settings WHERE scope=?),0)<>? THEN json('统一打包费已更新') ELSE 1 END`).bind(scope,rid,scope,b.updated_at));
  ss.push(d.prepare(`INSERT INTO packing_settings(scope,fee_cents,updated_at) SELECT ?,?,? WHERE ${guard} ON CONFLICT(scope) DO UPDATE SET fee_cents=excluded.fee_cents,updated_at=excluded.updated_at`).bind(scope,fee,now,scope,rid));return true;
 }
 if(b.action==='freight_period'){
  const month=validMonth(b.month),packing=cents(b.packing_fee,'每票打包人工费');
  const old=await d.prepare('SELECT updated_at FROM freight_periods WHERE scope=? AND month=?').bind(scope,month).first<{updated_at:number}>();if((old?.updated_at??0)!==b.updated_at)throw new Error('打包人工费已变化，请刷新后重试');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM freight_periods WHERE scope=? AND month=?),0)<>? THEN json('打包费已变化') ELSE 1 END`).bind(scope,rid,scope,month,b.updated_at));
  ss.push(d.prepare(`INSERT INTO freight_periods(scope,month,packing_cents,updated_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(scope,month) DO UPDATE SET packing_cents=excluded.packing_cents,updated_at=excluded.updated_at`).bind(scope,month,packing,now,scope,rid));return true;
 }
 if(b.action!=='freight_import')return false;
 const month=validMonth(b.month),batch=typeof b.batch_id==='string'?b.batch_id:'',filename=typeof b.filename==='string'?b.filename:'';
 if(!batch||batch.length>200||!filename||filename.length>300)throw new Error('缺少有效账单文件或批次');
 if(!Array.isArray(b.items)||b.items.length>60||typeof b.final!=='boolean')throw new Error('请每批导入最多60条运单费用');
 if(!Number.isSafeInteger(b.total)||b.total<0||!Number.isSafeInteger(b.skipped)||b.skipped<0||b.skipped>b.total)throw new Error('账单统计不正确');
 const profile=b.carrier_profile??'';if(!['','custom','yt','zt_yishan','zt_lingxi'].includes(profile))throw new Error('快递账单格式无效');
 const prior=await d.prepare('SELECT month,filename,total,skipped,carrier_profile FROM freight_imports WHERE scope=? AND id=?').bind(scope,batch).first<{month:string;filename:string;total:number;skipped:number;carrier_profile:string}>();
 if(prior&&(prior.month!==month||prior.filename!==filename||prior.total!==b.total||prior.skipped!==b.skipped||prior.carrier_profile!==profile))throw new Error('导入批次参数已变化，请重新选择文件');
 const seen=new Set<string>();
 ss.push(d.prepare(`INSERT INTO freight_imports(scope,id,month,filename,total,skipped,created_at,carrier_profile) SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO NOTHING`).bind(scope,batch,month,filename,b.total,b.skipped,now,profile,scope,rid));
 let matched=0;
 for(const item of b.items){
  if(typeof item.tracking!=='string')throw new Error('运单号格式不正确');const tracking=normalizeWaybill(item.tracking);if(seen.has(tracking))throw new Error('本批次运单号重复');seen.add(tracking);
  if(typeof item.fee_cents!=='number'||!Number.isSafeInteger(item.fee_cents)||item.fee_cents<0||item.fee_cents>1e10)throw new Error('快递费用无效');
  const rawFee=item.raw_fee==null?'':String(item.raw_fee);if(rawFee&&billAmount(rawFee).cents!==item.fee_cents)throw new Error('原始费用与核算金额不一致');
  const carrier=typeof item.carrier==='string'?item.carrier.trim():'';if(carrier.length>100)throw new Error('快递公司名称过长');
  // Ignore company parcels absent from this warehouse's ERP dataset.
  if(!await d.prepare('SELECT w.tracking FROM order_waybills w JOIN orders o ON o.scope=w.scope AND o.key=w.order_key WHERE w.scope=? AND w.tracking=? LIMIT 1').bind(scope,tracking).first())continue;
  const old=await d.prepare('SELECT fee_cents,month,updated_at FROM freight_bills WHERE scope=? AND tracking=?').bind(scope,tracking).first<{fee_cents:number;month:string;updated_at:number}>();
  if(old?.month&&old.month!==month)throw new Error('运单 '+tracking+' 已在 '+old.month+' 核验，请核对账单月份');
  if(old&&old.fee_cents!==item.fee_cents&&b.replace!==true)throw new Error('运单 '+tracking+' 的费用不同，请先确认覆盖');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM freight_bills WHERE scope=? AND tracking=?),0)<>? THEN json('账单费用已变化，请重新预览') ELSE 1 END`).bind(scope,rid,scope,tracking,old?.updated_at??0));
  ss.push(d.prepare(`INSERT INTO freight_bills(scope,tracking,month,carrier,fee_cents,filename,batch_id,updated_at,raw_fee) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} AND EXISTS(SELECT 1 FROM order_waybills w JOIN orders o ON o.scope=w.scope AND o.key=w.order_key WHERE w.scope=? AND w.tracking=?) ON CONFLICT(scope,tracking) DO UPDATE SET carrier=excluded.carrier,fee_cents=excluded.fee_cents,filename=excluded.filename,batch_id=excluded.batch_id,updated_at=excluded.updated_at,raw_fee=excluded.raw_fee`).bind(scope,tracking,month,carrier,item.fee_cents,filename,batch,now,rawFee,scope,rid,scope,tracking));matched++;
 }
 ss.push(d.prepare(`UPDATE freight_imports SET processed=processed+?,complete=? WHERE scope=? AND id=? AND ${guard}`).bind(matched,b.final?1:0,scope,batch,scope,rid));return true;
}
