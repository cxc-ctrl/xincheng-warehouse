import {readImportIgnoreRules,type ImportIgnoreRule} from './order-scope';
import type {OrderLine} from './model';
function input(b:Record<string,any>){const pattern=typeof b.pattern==='string'?b.pattern.trim():'';if(!pattern||pattern.length>160||/[\s%*?\r\n]/.test(pattern))throw Error('请填写完整商品编码或编码前缀，不要输入通配符');if(b.mode!=='prefix'&&b.mode!=='exact')throw Error('请选择完整编码或编码前缀');return {pattern,mode:b.mode as ImportIgnoreRule['mode']};}
async function candidates(d:D1Database,scope:string,pattern:string,mode:string){return (await d.prepare(`SELECT * FROM orders WHERE scope=? AND ${mode==='exact'?'code=?':'instr(code,?)=1'} ORDER BY shop,order_id,key`).bind(scope,pattern).all<OrderLine&{updated_at:number;reset:number}>()).results;}
async function blocked(d:D1Database,scope:string,o:OrderLine){
 if((o.deducted_qty??0)>0)return true;
 if(await d.prepare('SELECT 1 FROM order_stocks WHERE scope=? AND order_key=? AND deducted_qty>0 UNION ALL SELECT 1 FROM order_returns WHERE scope=? AND order_key=? LIMIT 1').bind(scope,o.key,scope,o.key).first())return true;
 const j=await d.prepare('SELECT accounting_mode,member_keys FROM print_jobs WHERE scope=? AND shop=? AND order_id=?').bind(scope,o.shop,o.order_id).first<{accounting_mode:string;member_keys:string}>();
 return !!j&&(j.accounting_mode!=='sku'||(JSON.parse(j.member_keys||'[]') as string[]).includes(o.key));
}
export async function previewImportIgnore(d:D1Database,scope:string,b:Record<string,any>){const {pattern,mode}=input(b),rows=await candidates(d,scope,pattern,mode);let blockedCount=0;for(const o of rows)if(await blocked(d,scope,o))blockedCount++;return {pattern,mode,count:rows.length,blocked:blockedCount,basis:rows.length<=500?JSON.stringify(rows.map(o=>[o.key,o.updated_at])):'',sample:rows.slice(0,8).map(o=>({code:o.code,title:o.title,shop:o.shop,order_id:o.order_id}))};}
export async function importIgnorePage(d:D1Database,scope:string){return {rules:await readImportIgnoreRules(d,scope),ignored:(await d.prepare('SELECT count(*) n FROM ignored_order_lines WHERE scope=?').bind(scope).first<{n:number}>())?.n??0};}
export async function appendImportIgnore(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='import_ignore_save'&&b.action!=='import_ignore_toggle')return false;
 if(b.action==='import_ignore_toggle'){
  if(typeof b.id!=='string'||![0,1].includes(b.enabled))throw Error('规则状态无效');
  const old=await d.prepare('SELECT pattern,updated_at FROM import_ignore_rules WHERE scope=? AND id=?').bind(scope,b.id).first<{pattern:string;updated_at:number}>();if(!old||old.updated_at!==b.updated_at)throw Error('规则已变化，请刷新');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM import_ignore_rules WHERE scope=? AND id=? AND updated_at=?) THEN json('规则已变化') ELSE 1 END`).bind(scope,rid,scope,b.id,b.updated_at));
  ss.push(d.prepare(`UPDATE import_ignore_rules SET enabled=?,updated_at=? WHERE scope=? AND id=? AND ${guard}`).bind(b.enabled,now,scope,b.id,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'order',?,0,?,?,?,'份' WHERE ${guard}`).bind(scope,crypto.randomUUID(),old.pattern,b.enabled?'启用导入忽略规则':'停用导入忽略规则','仅影响后续导入，历史归档保留',now,rid,scope,rid));return true;
 }
 const {pattern,mode}=input(b),note=typeof b.note==='string'?b.note.trim():'';if(note.length>500)throw Error('原因请控制在500字以内');
 if(await d.prepare('SELECT 1 FROM import_ignore_rules WHERE scope=? AND pattern=? AND mode=?').bind(scope,pattern,mode).first())throw Error('该规则已存在，请在列表中启用或停用');
 const rows=b.apply_existing===true?await candidates(d,scope,pattern,mode):[];
 if(b.apply_existing===true&&JSON.stringify(rows.map(o=>[o.key,o.updated_at]))!==b.basis)throw Error('已有订单已变化，请重新预览');
 if(rows.length>500)throw Error('匹配超过500条已有明细，请缩小编码范围后分批处理');
 for(const o of rows)if(await blocked(d,scope,o))throw Error('匹配明细已有扣库、退货或打印成本记录，请先核对；也可仅忽略后续导入');
 if(b.apply_existing===true)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (SELECT count(*) FROM orders WHERE scope=? AND ${mode==='exact'?'code=?':'instr(code,?)=1'})<>? THEN json('订单已变化，请重新预览') ELSE 1 END`).bind(scope,rid,scope,pattern,rows.length));
 for(const o of rows){
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=? AND deducted_qty=? AND reset=?) OR EXISTS(SELECT 1 FROM order_stocks WHERE scope=? AND order_key=? AND deducted_qty>0) OR EXISTS(SELECT 1 FROM order_returns WHERE scope=? AND order_key=?) OR EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=? AND j.shop=? AND j.order_id=? AND (COALESCE(j.accounting_mode,'whole')!='sku' OR EXISTS(SELECT 1 FROM json_each(j.member_keys) WHERE value=?)))) THEN json('订单库存或成本已变化，请重新预览') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at,o.deducted_qty??0,o.reset,scope,o.key,scope,o.key,scope,o.shop,o.order_id,o.key));
  const snapshot:Record<string,unknown>={order:o};for(const t of ['order_stocks','order_conflicts','order_returns','digit_fulfillments','digit_fulfillment_rules','order_finance','order_waybills'])snapshot[t]=(await d.prepare('SELECT * FROM '+t+' WHERE scope=? AND order_key=?').bind(scope,o.key).all()).results;
  ss.push(d.prepare(`INSERT INTO ignored_order_lines(scope,order_key,shop,order_id,code,payload,reason,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,order_key) DO UPDATE SET payload=excluded.payload,reason=excluded.reason,created_at=excluded.created_at`).bind(scope,o.key,o.shop,o.order_id,o.code,JSON.stringify(snapshot),note||'导入忽略规则：'+pattern,now,scope,rid));
  for(const t of ['order_stocks','order_conflicts','order_returns','digit_fulfillments','digit_fulfillment_rules','order_finance','order_waybills'])ss.push(d.prepare(`DELETE FROM ${t} WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
  ss.push(d.prepare(`DELETE FROM orders WHERE scope=? AND key=? AND ${guard}`).bind(scope,o.key,scope,rid));
  ss.push(d.prepare(`UPDATE import_conflict_groups SET status='ignored',resolved_at=? WHERE scope=? AND order_key=? AND status='pending' AND ${guard}`).bind(now,scope,o.key,scope,rid));
 }
 ss.push(d.prepare(`INSERT INTO import_ignore_rules(scope,id,pattern,mode,note,enabled,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),pattern,mode,note,now,now,scope,rid));
 ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'order','新增导入忽略规则',0,?,?,?,'份' WHERE ${guard}`).bind(scope,crypto.randomUUID(),pattern,`${mode==='prefix'?'前缀':'完整编码'}忽略；归档 ${rows.length} 条已有明细；${note}`,now,rid,scope,rid));return true;
}
