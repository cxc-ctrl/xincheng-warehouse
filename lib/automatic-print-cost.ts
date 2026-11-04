import {namedPrintContext,contextData,guardNamedEstimate} from './named-print-actions';
import {createLinkedPrintEstimator} from './named-print-rules';
import {printJobLines,printBasis,printGroup,type PrintJob} from './printing';
import type {OrderLine} from './model';

// Recoverable second phase: ERP receipts remain idempotent; a retry also retries
// this phase. Every cost snapshot has its own atomic guards and receipt.
export async function settleAutomaticPrintCosts(d:D1Database,scope:string,groups?:{shop:string;order_id:string}[]){
 const selected=groups?JSON.stringify(groups.map(g=>[g.shop,g.order_id])):null;
 const where=selected?' AND (j.shop,j.order_id) IN(SELECT json_extract(value,\'$[0]\'),json_extract(value,\'$[1]\') FROM json_each(?))':'';
 const args=selected?[scope,selected]:[scope];
 const jobs=(await d.prepare(`SELECT j.* FROM print_jobs j WHERE j.scope=? AND (j.cost_cents IS NULL OR j.cost_source='rule')${where}`).bind(...args).all<PrintJob>()).results;
 if(!jobs.length)return;
 const keys=JSON.stringify(jobs.map(j=>[j.shop,j.order_id]));
 const all=(await d.prepare("SELECT * FROM orders WHERE scope=? AND (shop,order_id) IN(SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)) ORDER BY key").bind(scope,keys).all<OrderLine&{updated_at:number}>()).results;
 const byGroup=new Map<string,typeof all>();for(const o of all){const key=printGroup(o),items=byGroup.get(key)??[];items.push(o);byGroup.set(key,items);}
 const candidates=jobs.map(job=>({job,all:byGroup.get(printGroup(job))??[]})).map(x=>({...x,lines:printJobLines(x.job,x.all)})).filter(x=>x.lines.length&&!(x.job.cost_cents!=null&&x.job.basis===printBasis(x.lines)&&!x.job.needs_review&&x.job.completed_at===Math.max(...x.lines.map(o=>o.shipped_at??o.order_time))));
 if(!candidates.length)return;
 const context=await namedPrintContext(d,scope);
 // Synced digital products use the configured pack size, including numeric SKU titles.
 const profiles=(await d.prepare("SELECT code,source_product,json_extract(config,'$.variant.supply_mode') supply_mode FROM product_supply_profiles WHERE scope=?").bind(scope).all<{code:string;source_product:string;supply_mode:string}>()).results;
 const pm=new Map(profiles.map(p=>[p.code,p]));context.products=context.products.map(p=>({...p,...pm.get(p.code)}));
 const calculate=createLinkedPrintEstimator(context.products,contextData(context));
 for(const {job,all:group,lines} of candidates){
  const frozen=job.cost_cents!=null&&job.basis===printBasis(lines)&&!job.needs_review&&job.estimate_snapshot?JSON.parse(job.estimate_snapshot):null;
  const estimate=frozen??calculate(lines);
  const complete=estimate.issues.length===0&&estimate.sheets!=null&&estimate.sheets>0&&estimate.cost_cents!=null&&Number.isSafeInteger(estimate.cost_cents);
  if(!complete&&job.cost_cents==null)continue;
  const now=Date.now(),rid='auto-print-cost:'+crypto.randomUUID(),guard='NOT EXISTS(SELECT 1 FROM receipts WHERE scope=? AND id=?)',ss:D1PreparedStatement[]=[];
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=? AND updated_at=? AND cost_cents IS ? AND cost_source=? AND member_keys=? AND basis=?) THEN json('打印成本已更新，请重试') ELSE 1 END`).bind(scope,rid,scope,job.shop,job.order_id,job.updated_at,job.cost_cents,job.cost_source,job.member_keys??'[]',job.basis));
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (SELECT COUNT(*) FROM orders WHERE scope=? AND shop=? AND order_id=?)<>? THEN json('订单商品已变化，请重试') ELSE 1 END`).bind(scope,rid,scope,job.shop,job.order_id,group.length));
  for(const o of group)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=?) THEN json('订单已变化，请重试') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at));
  guardNamedEstimate(d,scope,rid,guard,ss,lines,context);
  const at=Math.max(...lines.map(o=>o.shipped_at??o.order_time));
  const snapshot=JSON.stringify({source:'rule',at:now,paper:{length_cm:32,width_cm:46.4},...estimate});
  ss.push(d.prepare(`UPDATE print_jobs SET cost_cents=?,actual_quantity=?,unit='张',status=?,completed_at=?,basis=?,needs_review=0,cost_source='rule',estimate_snapshot=?,updated_at=? WHERE scope=? AND shop=? AND order_id=? AND ${guard}`).bind(complete?estimate.cost_cents:null,complete?estimate.sheets:null,complete?'done':'queued',complete?at:null,printBasis(lines),snapshot,now,scope,job.shop,job.order_id,scope,rid));
  ss.push(d.prepare(`INSERT INTO print_events(scope,id,shop,order_id,action,note,at) SELECT ?,?,?,?,'规则自动计入成本',?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),job.shop,job.order_id,JSON.stringify({previous_cost_cents:job.cost_cents,cost_cents:complete?estimate.cost_cents:null,issues:estimate.issues}),now,scope,rid));
  ss.push(d.prepare('INSERT INTO receipts(scope,id,at) VALUES(?,?,?)').bind(scope,rid,now));
  await d.batch(ss);
 }
}
