import {readRemarkRules} from './digit-remark-actions';
import {appendNamedPrintAction,readNamedPrintRules,namedPrintContext,contextData,guardNamedEstimate} from './named-print-actions';
import {estimateLinkedPrinting} from './named-print-rules';
import {estimatePrinting,printRule,printNumber} from './print-recipes';
import {cents,allocateCents} from './freight-reconciliation';
import {printJobLines,printBasis,printLineBasis,printGroup,printOrderStatus,printCostNeedsReview,EMPTY_PAPER,type PrintPaperSettings,type PrintSizeRule,type PrintCatalog,type PrintJob,type PrintEvent,type PrintData} from './printing';
import {digitSignature} from './digit-colors';
import type {OrderLine} from './model';
type Row=OrderLine&{updated_at:number;reset:number};
const text=(v:unknown,label:string,max=1000)=>{if(typeof v!=='string'||v.length>max)throw new Error(label+'格式或长度不正确');return v.trim();};
const groupSQL='SELECT * FROM orders WHERE scope=? AND shop=? AND order_id=? ORDER BY key';
export async function readPrinting(d:D1Database,scope:string):Promise<PrintData>{const r=await d.batch([d.prepare('SELECT * FROM print_catalog WHERE scope=? ORDER BY name,code').bind(scope),d.prepare('SELECT * FROM print_jobs WHERE scope=? ORDER BY created_at DESC').bind(scope),d.prepare('SELECT * FROM print_events WHERE scope=? ORDER BY at DESC LIMIT 100').bind(scope),d.prepare('SELECT * FROM print_paper_settings WHERE scope=?').bind(scope),d.prepare('SELECT * FROM print_size_rules WHERE scope=? ORDER BY size_cm').bind(scope)]);return {digitRemarkRules:await readRemarkRules(d,scope),printCatalog:r[0].results as PrintCatalog[],printJobs:r[1].results as PrintJob[],printEvents:r[2].results as PrintEvent[],printPaperSettings:(r[3].results[0] as PrintPaperSettings|undefined)??EMPTY_PAPER,printSizeRules:r[4].results as PrintSizeRule[],...await readNamedPrintRules(d,scope)};}
export function enrichPrinting(orders:OrderLine[],jobs:PrintJob[]){const map=new Map(jobs.map(j=>[printGroup(j),j])),lines=new Map<string,OrderLine[]>();for(const o of orders){const k=printGroup(o),a=lines.get(k)??[];a.push(o);lines.set(k,a);}const allocations=new Map<string,number>();for(const [k,all] of lines){const j=map.get(k),group=j?printJobLines(j,all):[];if(group.length&&j?.cost_cents!=null&&j.status==='done'&&!j.needs_review&&j.basis===printBasis(group)){
 const rows=j.cost_source==='rule'&&j.estimate_snapshot?JSON.parse(j.estimate_snapshot).rows as {code:string;cost_cents:number}[]:null;
 if(rows&&rows.reduce((n,r)=>n+r.cost_cents,0)===j.cost_cents){for(const row of rows)for(const [key,value] of allocateCents(row.cost_cents,group.filter(o=>o.code===row.code).map(o=>o.key)))allocations.set(key,value/100);}
 else for(const [key,value] of allocateCents(j.cost_cents,group.map(o=>o.key)))allocations.set(key,value/100);
 }}return orders.map(o=>{const j=map.get(printGroup(o)),group=j?printJobLines(j,lines.get(printGroup(o))!):[];return j&&group.some(line=>line.key===o.key)?{...o,fulfillment_mode:'print' as const,printing_note:j.note,printing_cost:j.cost_cents==null?null:j.cost_cents/100,printing_allocated_cost:allocations.get(o.key)??null,printing_needs_review:printCostNeedsReview(j,group),printing_status:printOrderStatus(group)}:o;});}
function audit(d:D1Database,scope:string,shop:string,id:string,action:string,note:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){ss.push(d.prepare(`INSERT INTO print_events(scope,id,shop,order_id,action,note,at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),shop,id,action,note,now,scope,rid));}
function guardRows(d:D1Database,scope:string,shop:string,id:string,lines:Row[],rid:string,ss:D1PreparedStatement[],guard:string){ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (SELECT COUNT(*) FROM orders WHERE scope=? AND shop=? AND order_id=?)<>? THEN json('订单商品已变化，请刷新重试') ELSE 1 END`).bind(scope,rid,scope,shop,id,lines.length));for(const o of lines)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=? AND deducted_qty=? AND reset=?) THEN json('订单已变化，请刷新重试') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at,o.deducted_qty??0,o.reset));}
async function transfer(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 let shop:string,id:string;
 if(b.action==='digit_print'){
  const o=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,b.key).first<Row>(),f=await d.prepare('SELECT updated_at FROM digit_fulfillments WHERE scope=? AND order_key=?').bind(scope,b.key).first<{updated_at:number}>();if(!o||!f||f.updated_at!==b.expected_at||digitSignature(o)!==b.signature)throw new Error('订单已更新，请刷新');shop=o.shop;id=o.order_id;
 }else{shop=text(b.shop,'店铺',160);id=text(b.order_id,'订单号',160);}
 const lines=(await d.prepare(groupSQL).bind(scope,shop,id).all<Row>()).results;if(!lines.length)throw new Error('没有找到该订单');if(lines.some(o=>o.review===1||['已关闭','已取消','未付款','待付款'].includes(o.status)))throw new Error('请先核对整单状态，取消、退款或未付款订单不能直接安排打印');if(lines.length>150)throw new Error('该订单商品行过多，请先核对');
 const job=await d.prepare('SELECT * FROM print_jobs WHERE scope=? AND shop=? AND order_id=?').bind(scope,shop,id).first<PrintJob>();
 if(job?.accounting_mode==='sku')throw new Error('这张订单按SKU自动核算数码打印费用，现货商品继续按库存处理，无需整单转打印');
 if(b.action!=='digit_print'&&(b.basis!==printBasis(lines)||(job?.updated_at??0)!==b.updated_at))throw new Error('整单资料已变化，请刷新后重试');
 const note=text(b.note??b.print_note,'打印说明');if(!note)throw new Error('请填写整单打印说明');
 if(await d.prepare('SELECT 1 FROM order_conflicts c JOIN orders o ON o.scope=c.scope AND o.key=c.order_key WHERE o.scope=? AND o.shop=? AND o.order_id=? LIMIT 1').bind(scope,shop,id).first())throw new Error('整单内有ERP数据冲突，请先核对');
 if(await d.prepare('SELECT 1 FROM order_returns r JOIN orders o ON o.scope=r.scope AND o.key=r.order_key WHERE o.scope=? AND o.shop=? AND o.order_id=? LIMIT 1').bind(scope,shop,id).first())throw new Error('整单已有退货入库，不能直接转打印，请先核对库存流水');
 const used=(await d.prepare("SELECT 'physical' kind,os.stock_code code,SUM(os.deducted_qty) quantity FROM order_stocks os JOIN orders o ON o.scope=os.scope AND o.key=os.order_key WHERE o.scope=? AND o.shop=? AND o.order_id=? AND os.reset=0 AND os.deducted_qty>0 GROUP BY os.stock_code UNION ALL SELECT 'product',o.code,SUM(o.deducted_qty) FROM orders o WHERE o.scope=? AND o.shop=? AND o.order_id=? AND o.reset=0 AND o.deducted_qty>0 GROUP BY o.code").bind(scope,shop,id,scope,shop,id).all<{kind:'physical'|'product';code:string;quantity:number}>()).results;
 if(used.length&&b.stock_returned!==true&&b.quick!==true)throw new Error('该订单已有现货扣减，请确认全部未领出或已归还，再整单转打印');
 guardRows(d,scope,shop,id,lines,rid,ss,guard);
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_jobs WHERE scope=? AND shop=? AND order_id=?),0)<>? THEN json('打印任务已变化') ELSE 1 END`).bind(scope,rid,scope,shop,id,job?.updated_at??0));
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (EXISTS(SELECT 1 FROM order_returns r JOIN orders o ON o.scope=r.scope AND o.key=r.order_key WHERE o.scope=? AND o.shop=? AND o.order_id=?) OR EXISTS(SELECT 1 FROM order_conflicts c JOIN orders o ON o.scope=c.scope AND o.key=c.order_key WHERE o.scope=? AND o.shop=? AND o.order_id=?)) THEN json('整单核对状态已变化') ELSE 1 END`).bind(scope,rid,scope,shop,id,scope,shop,id));
 ss.push(d.prepare(`INSERT INTO print_jobs(scope,shop,order_id,note,basis,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,shop,order_id) DO UPDATE SET note=excluded.note,needs_review=CASE WHEN print_jobs.basis<>excluded.basis OR print_jobs.note<>excluded.note THEN 1 ELSE print_jobs.needs_review END,updated_at=excluded.updated_at`).bind(scope,shop,id,note,printBasis(lines),now,now,scope,rid));
 for(const u of used){
  const table=u.kind==='physical'?'physical_stocks':'products',s=await d.prepare(`SELECT quantity,count_at,updated_at,unit FROM ${table} WHERE scope=? AND code=? ${u.kind==='physical'?'AND archived=0':"AND stock_mode='direct' AND tracking_enabled=1"}`).bind(scope,u.code).first<{quantity:number|null;count_at:number|null;updated_at:number;unit:string}>();if(!s||s.quantity==null)throw new Error('原扣减库存已移除或未盘点，请先核对：'+u.code);
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND quantity IS ? AND count_at IS ? AND updated_at=?) THEN json('库存已变化，请刷新确认') ELSE 1 END`).bind(scope,rid,scope,u.code,s.quantity,s.count_at,s.updated_at));
  if(u.kind==='physical')ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT SUM(os.deducted_qty) FROM order_stocks os JOIN orders o ON o.scope=os.scope AND o.key=os.order_key WHERE o.scope=? AND o.shop=? AND o.order_id=? AND os.stock_code=? AND os.reset=0),0)<>? THEN json('原扣减已变化') ELSE 1 END`).bind(scope,rid,scope,shop,id,u.code,u.quantity));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(u.quantity,now,scope,u.code,scope,rid));
  // A later backdated count may fall between the original shipment and this
  // confirmed return. Retain the paired quantities so that count replays add
  // only returns not already represented by the entered count baseline.
  if(u.kind==='physical')ss.push(d.prepare(`INSERT INTO print_stock_corrections(scope,id,kind,code,quantity,shipment_at,returned_at,shop,order_id) SELECT o.scope,lower(hex(randomblob(16))),'physical',os.stock_code,os.deducted_qty,COALESCE(o.shipped_at,o.order_time),?,o.shop,o.order_id FROM order_stocks os JOIN orders o ON o.scope=os.scope AND o.key=os.order_key WHERE o.scope=? AND o.shop=? AND o.order_id=? AND os.stock_code=? AND os.reset=0 AND os.deducted_qty>0 AND ${guard}`).bind(now,scope,shop,id,u.code,scope,rid));
  else ss.push(d.prepare(`INSERT INTO print_stock_corrections(scope,id,kind,code,quantity,shipment_at,returned_at,shop,order_id) SELECT scope,lower(hex(randomblob(16))),'product',code,deducted_qty,COALESCE(shipped_at,order_time),?,shop,order_id FROM orders WHERE scope=? AND shop=? AND order_id=? AND code=? AND reset=0 AND deducted_qty>0 AND ${guard}`).bind(now,scope,shop,id,u.code,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,?,'整单转打印回补',?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),u.code,u.kind,u.quantity,'订单 '+id+' 整单转打印；'+(b.quick===true?'用户点击安排打印，校正原现货扣减；':'已确认全部未领出或已归还；')+note,now,rid,s.unit,scope,rid));
 }
 ss.push(d.prepare(`UPDATE order_stocks SET deducted_qty=0,reset=1,updated_at=? WHERE scope=? AND order_key IN(SELECT key FROM orders WHERE scope=? AND shop=? AND order_id=?) AND ${guard}`).bind(now,scope,scope,shop,id,scope,rid));
 ss.push(d.prepare(`DELETE FROM digit_fulfillment_rules WHERE scope=? AND order_key IN(SELECT key FROM orders WHERE scope=? AND shop=? AND order_id=?) AND ${guard}`).bind(scope,scope,shop,id,scope,rid));
 for(const o of lines)ss.push(d.prepare(`INSERT INTO digit_fulfillments(scope,order_key,status,color,reason,signature,updated_at) SELECT ?,?,'print',?,'整张订单所有商品统一打印；实际成本在数码打印录入',?,? WHERE ${guard} ON CONFLICT(scope,order_key) DO UPDATE SET status='print',color=excluded.color,reason=excluded.reason,signature=excluded.signature,updated_at=excluded.updated_at`).bind(scope,o.key,note,digitSignature(o),now,scope,rid));
 ss.push(d.prepare(`UPDATE orders SET deducted_qty=0,reset=1,unit_cost_snapshot=NULL,updated_at=? WHERE scope=? AND shop=? AND order_id=? AND ${guard}`).bind(now,scope,shop,id,scope,rid));
 audit(d,scope,shop,id,'整单转打印',note+'；全部 '+lines.length+' 项商品；现货校正 '+used.length+' 项',now,rid,ss,guard);
}
async function saveCost(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 const shop=text(b.shop,'店铺',160),id=text(b.order_id,'订单号',160),job=await d.prepare('SELECT * FROM print_jobs WHERE scope=? AND shop=? AND order_id=?').bind(scope,shop,id).first<PrintJob>();if(!job||job.updated_at!==b.updated_at)throw new Error('打印任务已变化，请刷新：'+id);
 const allLines=(await d.prepare(groupSQL).bind(scope,shop,id).all<Row>()).results,lines=printJobLines(job,allLines) as Row[];if(!lines.length||b.basis!==printBasis(lines))throw new Error('整单商品或规格已变化，请重新核对打印数量和成本：'+id);
 const status=b.confirm_cost===true?'done':b.status;if(!['queued','producing','done','cancelled'].includes(status))throw new Error('请选择打印状态');const note=text(b.note,'打印说明'),unit=text(b.unit,'数量单位',10);if(!note||!unit)throw new Error('请填写打印说明和数量单位');
 const quantity=b.actual_quantity==null||b.actual_quantity===''?null:Number(b.actual_quantity);if(quantity!=null&&(!Number.isSafeInteger(quantity)||quantity<0||quantity>1e8))throw new Error('实际打印数量不正确');
 const cost=b.total_cost==null||b.total_cost===''?null:cents(b.total_cost,'整单打印总成本');
 if(status==='done'&&(quantity==null||quantity<=0||cost==null))throw new Error('确认成本时须填写实际打印数量及整单总成本');
 const weight=b.actual_weight_g===undefined?job.actual_weight_g??null:printNumber(b.actual_weight_g,'实际重量');if(weight===0)throw new Error('实际重量须大于0，未知请留空');
 let snapshot:string|null=null;
 if(b.estimate_basis!=null){
  if(b.estimate_mode==='linked'||String(b.estimate_basis).startsWith('["linked-v1"')){
   const context=await namedPrintContext(d,scope),estimate=estimateLinkedPrinting(lines,context.products,contextData(context));if(estimate.basis!==b.estimate_basis)throw new Error('打印规则、工序价格或关联已变化，请刷新后重新确认');
   snapshot=JSON.stringify({at:now,paper:{length_cm:32,width_cm:46.4},...estimate});guardNamedEstimate(d,scope,rid,guard,ss,lines,context);
  }else{

  const settings=await d.prepare('SELECT * FROM print_paper_settings WHERE scope=?').bind(scope).first<PrintPaperSettings>()??EMPTY_PAPER;
  const catalog=(await d.prepare('SELECT * FROM print_catalog WHERE scope=?').bind(scope).all<PrintCatalog>()).results;
  const sizes=(await d.prepare('SELECT * FROM print_size_rules WHERE scope=? ORDER BY size_cm').bind(scope).all<PrintSizeRule>()).results;
  const estimate=estimatePrinting(lines,catalog,settings,sizes);if(estimate.basis!==b.estimate_basis)throw new Error('打印规则或纸张价格已变化，请刷新预计数据后重新确认');
  snapshot=JSON.stringify({at:now,paper:{length_cm:32,width_cm:46.4},...estimate});
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_paper_settings WHERE scope=?),0)<>? THEN json('纸张设置已变化') ELSE 1 END`).bind(scope,rid,scope,settings.updated_at));
  for(const code of new Set(lines.map(o=>o.code))){const rule=catalog.find(c=>c.code===code);ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_catalog WHERE scope=? AND code=?),0)<>? THEN json('打印规则已变化') ELSE 1 END`).bind(scope,rid,scope,code,rule?.updated_at??0));}
  for(const size of estimate.rule_sizes){const rule=sizes.find(r=>r.size_cm===size);ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_size_rules WHERE scope=? AND size_cm=?),0)<>? THEN json('通用打印规则已变化') ELSE 1 END`).bind(scope,rid,scope,size,rule?.updated_at??0));}
  }
 }
 const at=b.completed_at==null?null:Number(b.completed_at);if(at!=null&&(!Number.isSafeInteger(at)||at<946684800000||at>now+60000))throw new Error('完成日期不正确');
 guardRows(d,scope,shop,id,allLines,rid,ss,guard);
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=? AND updated_at=?) THEN json('打印成本已更新，请刷新') ELSE 1 END`).bind(scope,rid,scope,shop,id,job.updated_at));
 ss.push(d.prepare(`UPDATE print_jobs SET cost_source='manual',note=?,status=?,actual_quantity=?,unit=?,cost_cents=?,actual_weight_g=?,estimate_snapshot=?,completed_at=?,basis=?,needs_review=0,updated_at=? WHERE scope=? AND shop=? AND order_id=? AND ${guard}`).bind(note,status,quantity,unit,cost,weight,snapshot,at??(status==='done'?now:null),printBasis(lines),now,scope,shop,id,scope,rid));
 audit(d,scope,shop,id,'打印成本',JSON.stringify({previous_cost_cents:job.cost_cents,cost_cents:cost,quantity,unit,actual_weight_g:weight,status,note}),now,rid,ss,guard);
}
export async function appendPrintingAction(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(await appendNamedPrintAction(b,d,scope,now,rid,ss,guard))return true;
 if(b.action==='print_transfer'||b.action==='digit_print'){await transfer(b,d,scope,now,rid,ss,guard);return true;}
 if(b.action==='print_cost'){await saveCost(b,d,scope,now,rid,ss,guard);return true;}
 if(b.action==='print_cost_import'){if(!Array.isArray(b.items)||!b.items.length||b.items.length>5)throw new Error('每批最多导入5笔打印成本');const seen=new Set<string>();for(const item of b.items){const key=JSON.stringify([item.shop,item.order_id]);if(seen.has(key))throw new Error('本批次打印订单重复');seen.add(key);await saveCost(item,d,scope,now,rid,ss,guard);}return true;}
 if(b.action==='print_size_rule'){
  const size=printNumber(b.size_cm,'尺寸'),perSheet=printNumber(b.per_sheet,'每张可印数量',true),cost=printNumber(b.sheet_cost,'每张打印成本'),weight=printNumber(b.sheet_weight_g,'每张重量');
  if(size==null||size<=0||size>200||perSheet==null)throw new Error('请填写有效尺寸和每张可印数量');if(weight===0)throw new Error('每张重量须大于0，未知请留空');
  const enabled=b.enabled??1;if(enabled!==0&&enabled!==1)throw new Error('启用状态不正确');
  const old=await d.prepare('SELECT updated_at FROM print_size_rules WHERE scope=? AND size_cm=?').bind(scope,size).first<{updated_at:number}>();if((old?.updated_at??0)!==b.updated_at)throw new Error('这个尺寸的规则已变化，请刷新后重试');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_size_rules WHERE scope=? AND size_cm=?),0)<>? THEN json('通用打印规则已变化') ELSE 1 END`).bind(scope,rid,scope,size,old?.updated_at??0));
  ss.push(d.prepare(`INSERT INTO print_size_rules(scope,size_cm,per_sheet,sheet_cost,sheet_weight_g,enabled,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,size_cm) DO UPDATE SET per_sheet=excluded.per_sheet,sheet_cost=excluded.sheet_cost,sheet_weight_g=excluded.sheet_weight_g,enabled=excluded.enabled,updated_at=excluded.updated_at`).bind(scope,size,perSheet,cost,weight,enabled,now,scope,rid));return true;
 }
 if(b.action==='print_paper_settings'){
  const cost=printNumber(b.sheet_cost,'默认每张打印成本'),weight=printNumber(b.sheet_weight_g,'默认每张重量');if(weight===0)throw new Error('每张重量须大于0，未知请留空');
  const old=await d.prepare('SELECT updated_at FROM print_paper_settings WHERE scope=?').bind(scope).first<{updated_at:number}>();if((old?.updated_at??0)!==b.updated_at)throw new Error('纸张设置已变化，请刷新');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_paper_settings WHERE scope=?),0)<>? THEN json('纸张设置已变化') ELSE 1 END`).bind(scope,rid,scope,old?.updated_at??0));
  ss.push(d.prepare(`INSERT INTO print_paper_settings(scope,sheet_cost,sheet_weight_g,updated_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(scope) DO UPDATE SET sheet_cost=excluded.sheet_cost,sheet_weight_g=excluded.sheet_weight_g,updated_at=excluded.updated_at`).bind(scope,cost,weight,now,scope,rid));return true;
 }
 if(b.action!=='print_catalog')return false;
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)throw new Error('每批最多保存30个打印商品');const seen=new Set<string>();
 for(const raw of b.items){const code=text(raw.code,'SKU编码',160),name=text(raw.name,'商品名称',300),spec=text(raw.spec??'','规格',500),material=text(raw.material??'','材质',160),unit=text(raw.unit??'份','单位',10),note=text(raw.note??'','打印说明');if(!code||!name||!unit||seen.has(code))throw new Error('商品编码、名称和单位必填，同批编码不能重复');seen.add(code);const enabled=raw.enabled===0?0:1;
  const old=await d.prepare('SELECT * FROM print_catalog WHERE scope=? AND code=?').bind(scope,code).first<PrintCatalog>();if((old?.updated_at??0)!==(raw.updated_at??0))throw new Error('打印商品已更新，请刷新后重试：'+code);
  const rule=printRule(raw,old??undefined);
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_catalog WHERE scope=? AND code=?),0)<>? THEN json('打印商品已更新') ELSE 1 END`).bind(scope,rid,scope,code,old?.updated_at??0));
  ss.push(d.prepare(`INSERT INTO print_catalog(scope,code,name,spec,material,unit,note,enabled,updated_at,per_pack,per_sheet,sheet_cost,sheet_weight_g,layout_mode) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,code) DO UPDATE SET name=excluded.name,spec=excluded.spec,material=excluded.material,unit=excluded.unit,note=excluded.note,enabled=excluded.enabled,updated_at=excluded.updated_at,per_pack=excluded.per_pack,per_sheet=excluded.per_sheet,sheet_cost=excluded.sheet_cost,sheet_weight_g=excluded.sheet_weight_g,layout_mode=excluded.layout_mode`).bind(scope,code,name,spec,material,unit,note,enabled,now,rule.per_pack,rule.per_sheet,rule.sheet_cost,rule.sheet_weight_g,rule.layout_mode,scope,rid));
 }return true;
}
export async function appendPrintingImport(d:D1Database,scope:string,o:OrderLine,old:OrderLine|undefined,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 const j=await d.prepare('SELECT * FROM print_jobs WHERE scope=? AND shop=? AND order_id=?').bind(scope,o.shop,o.order_id).first<PrintJob>();if(!j||!printJobLines(j,[o]).length)return false;
 ss.push(d.prepare(`UPDATE digit_fulfillments SET signature=?,reason=CASE WHEN signature<>? THEN 'ERP备注、规格或数量已变化，请在数码打印重新核对整单实际成本' ELSE reason END,updated_at=? WHERE scope=? AND order_key=? AND status='print' AND ${guard}`).bind(digitSignature(o),digitSignature(o),now,scope,o.key,scope,rid));
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=? AND updated_at=?) THEN json('打印任务已更新，请重新导入') ELSE 1 END`).bind(scope,rid,scope,o.shop,o.order_id,j.updated_at));
 if(!old||printLineBasis(old)!==printLineBasis(o)){ss.push(d.prepare(`UPDATE print_jobs SET needs_review=1 WHERE scope=? AND shop=? AND order_id=? AND ${guard}`).bind(scope,o.shop,o.order_id,scope,rid));audit(d,scope,o.shop,o.order_id,'ERP变更',j.accounting_mode==='sku'?'数码打印商品、数量或备注变化，原实际成本保留，请重新核定打印部分':'ERP商品、数量或备注变化，历史整单仍按打印履约，原成本保留但须重新核定',now,rid,ss,guard);}
 return true;
}
