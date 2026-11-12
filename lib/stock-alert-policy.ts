import {readImportIgnoreRules,type ImportIgnoreRule} from './order-scope';
import type {OrderLine} from './model';
export const ALERT_DAY=86400000;
export type AlertSettings={sheetMinimum:number;stickerMinimum:number;leadDays:number;bufferDays:number;updated_at:number};
export const DEFAULT_ALERT_SETTINGS:AlertSettings={sheetMinimum:200,stickerMinimum:2000,leadDays:3,bufferDays:2,updated_at:0};
export type AlertIgnore={kind:'physical'|'product';code:string;until_at:number;updated_at:number};
export type AlertSample={filename:string;start_at:number;end_at:number;orders:OrderLine[]};
export type AlertPolicy={settings:AlertSettings;ignores:AlertIgnore[];sample?:AlertSample;excluded?:string[];importIgnoreRules?:ImportIgnoreRule[]};
export async function readAlertPolicy(d:D1Database,scope:string):Promise<AlertPolicy>{
 const [s,i,p,e]=await d.batch([d.prepare('SELECT * FROM stock_alert_settings WHERE scope=?').bind(scope),d.prepare('SELECT kind,code,until_at,updated_at FROM stock_alert_ignores WHERE scope=?').bind(scope),d.prepare('SELECT * FROM stock_alert_sample WHERE scope=?').bind(scope),d.prepare('SELECT shop,order_id FROM work_order_exclusions WHERE scope=?').bind(scope)]);
 const row=s.results[0] as {payload:string;updated_at:number}|undefined,sample=p.results[0] as {filename:string;start_at:number;end_at:number;orders_json:string}|undefined;
 return {importIgnoreRules:await readImportIgnoreRules(d,scope),settings:row?{...DEFAULT_ALERT_SETTINGS,...JSON.parse(row.payload),updated_at:row.updated_at}:{...DEFAULT_ALERT_SETTINGS},ignores:i.results as AlertIgnore[],sample:sample?{filename:sample.filename,start_at:sample.start_at,end_at:sample.end_at,orders:JSON.parse(sample.orders_json)}:undefined,excluded:e.results.map((r:any)=>JSON.stringify([r.shop,r.order_id]))};
}
export async function appendAlertPolicy(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action==='stock_alert_settings'){
  const input=b.settings??{},settings={...DEFAULT_ALERT_SETTINGS};
  for(const k of ['sheetMinimum','stickerMinimum','leadDays','bufferDays'] as const){const n=input[k];if(!Number.isSafeInteger(n)||n<0||n>(k.endsWith('Days')?90:10000000)||(k==='leadDays'&&n<1))throw new Error('预警设置须为有效整数，采购天数至少为1');settings[k]=n;}
  const old=await d.prepare('SELECT updated_at FROM stock_alert_settings WHERE scope=?').bind(scope).first<{updated_at:number}>();if(input.updated_at!==(old?.updated_at??0))throw new Error('预警设置已变化，请刷新后重试');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM stock_alert_settings WHERE scope=?),0)<>? THEN json('预警设置已变化') ELSE 1 END`).bind(scope,rid,scope,input.updated_at));
  ss.push(d.prepare(`INSERT INTO stock_alert_settings(scope,payload,updated_at) SELECT ?,?,? WHERE ${guard} ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(scope,JSON.stringify(settings),Math.max(now,input.updated_at+1),scope,rid));return true;
 }
 if(b.action==='stock_alert_ignore'){
  if(!['physical','product'].includes(b.kind)||typeof b.code!=='string'||b.code.length>200||!['week','forever','restore'].includes(b.mode))throw new Error('忽略设置无效');
  const table=b.kind==='physical'?'physical_stocks':'products';if(!await d.prepare(`SELECT 1 FROM ${table} WHERE scope=? AND code=?`).bind(scope,b.code).first())throw new Error('货品不存在');
  const old=await d.prepare('SELECT updated_at FROM stock_alert_ignores WHERE scope=? AND kind=? AND code=?').bind(scope,b.kind,b.code).first<{updated_at:number}>();if((old?.updated_at??0)!==b.updated_at)throw new Error('忽略状态已变化，请刷新后重试');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM stock_alert_ignores WHERE scope=? AND kind=? AND code=?),0)<>? THEN json('忽略状态已变化') ELSE 1 END`).bind(scope,rid,scope,b.kind,b.code,b.updated_at));
  ss.push(d.prepare(`INSERT INTO stock_alert_ignores(scope,kind,code,until_at,updated_at) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,kind,code) DO UPDATE SET until_at=excluded.until_at,updated_at=excluded.updated_at`).bind(scope,b.kind,b.code,b.mode==='forever'?0:b.mode==='restore'?-1:now+7*ALERT_DAY,Math.max(now,b.updated_at+1),scope,rid));
  ss.push(d.prepare(`UPDATE ${table} SET ignore_warning=? WHERE scope=? AND code=? AND ${guard}`).bind(b.mode==='forever'?1:0,scope,b.code,scope,rid));return true;
 }return false;
}

