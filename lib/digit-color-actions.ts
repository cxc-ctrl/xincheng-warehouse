import {readHistoricalCountedKeys,historicalCounted} from './historical-counted-orders';
import {readRemarkRules,guardRemarkRules} from './digit-remark-actions';
import {fixedGroupPlan,savedFixedGroups} from './digit-fixed-groups';
import {DIGIT_CATALOG,RED_COLOR,digitSheet,digitSignature,fulfillmentPlan,type DigitVariant,type DigitFulfillment,type DigitItem,type ColorAllocation} from './digit-colors';
import {readDigitConditions,guardDigitConditions} from './warehouse-digit-conditions';
import {isValid,type OrderLine,type PhysicalStock,type StockRule} from './model';
export async function readDigitColors(d:D1Database,scope:string){
 const result=await d.batch([d.prepare('SELECT base_code,color,stock_code,size,start,end,available_end FROM digit_stock_variants WHERE scope=?').bind(scope),d.prepare('SELECT order_key,status,color,reason,signature,updated_at,fixed_groups FROM digit_fulfillments WHERE scope=?').bind(scope),d.prepare("SELECT r.order_key,r.stock_code,1.0*r.per_unit*COALESCE(r.allocated_qty,o.quantity)/o.quantity AS per_unit,r.per_unit*COALESCE(r.allocated_qty,o.quantity) AS quantity,COALESCE(r.allocated_qty,o.quantity) AS allocated_qty,v.color FROM digit_fulfillment_rules r JOIN orders o ON o.scope=r.scope AND o.key=r.order_key JOIN digit_fulfillments f ON f.scope=r.scope AND f.order_key=r.order_key LEFT JOIN digit_stock_variants v ON v.scope=r.scope AND v.stock_code=r.stock_code AND (v.base_code IN (SELECT stock_code FROM stock_rules WHERE scope=r.scope AND sales_code=r.sales_code) OR v.base_code IN (SELECT value FROM json_each(CASE WHEN f.fixed_groups='' THEN '[]' ELSE f.fixed_groups END))) WHERE r.scope=? AND f.status IN ('auto','manual')").bind(scope)]);
 const routes=result[2].results as {order_key:string;stock_code:string;per_unit:number;quantity:number;allocated_qty:number;color:string}[];
 const allocations=new Map<string,Map<string,ColorAllocation>>();for(const r of routes)if(r.color){const map=allocations.get(r.order_key)??new Map();map.set(r.color,{color:r.color,quantity:r.allocated_qty});allocations.set(r.order_key,map);}
 const historical=await readHistoricalCountedKeys(d,scope);
 const choices=(result[1].results as DigitFulfillment[]).map(f=>({...f,historical_counted:historical.has(f.order_key),allocations:[...(allocations.get(f.order_key)?.values()??[])]}));
 return {digitConditions:await readDigitConditions(d,scope),digitVariants:result[0].results as DigitVariant[],digitFulfillments:choices,digitOrderRules:routes};
}
async function inputs(d:D1Database,scope:string,code?:string){
 const r=await d.batch(code?[
 d.prepare('SELECT * FROM physical_stocks WHERE scope=? AND code IN (SELECT stock_code FROM digit_stock_variants WHERE scope=? AND base_code IN (SELECT stock_code FROM stock_rules WHERE scope=? AND sales_code=?))').bind(scope,scope,scope,code),
 d.prepare('SELECT * FROM stock_rules WHERE scope=? AND sales_code=?').bind(scope,code),
 d.prepare('SELECT * FROM digit_stock_variants WHERE scope=? AND base_code IN (SELECT stock_code FROM stock_rules WHERE scope=? AND sales_code=?)').bind(scope,scope,code)
 ]:[d.prepare('SELECT * FROM physical_stocks WHERE scope=?').bind(scope),d.prepare('SELECT * FROM stock_rules WHERE scope=?').bind(scope),d.prepare('SELECT * FROM digit_stock_variants WHERE scope=?').bind(scope)]);
 return {remarkRules:await readRemarkRules(d,scope),conditions:await readDigitConditions(d,scope),stocks:r[0].results as PhysicalStock[],rules:r[1].results as StockRule[],variants:r[2].results as DigitVariant[]};
}
export function saveChoice(d:D1Database,ss:D1PreparedStatement[],scope:string,o:OrderLine,now:number,rid:string,guard:string,status:string,color:string,reason:string,items:DigitItem[],fixedGroups?:string){
 ss.push(d.prepare(`INSERT INTO digit_fulfillments(scope,order_key,status,color,reason,signature,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,order_key) DO UPDATE SET status=excluded.status,color=excluded.color,reason=excluded.reason,signature=excluded.signature,updated_at=excluded.updated_at`).bind(scope,o.key,status,color,reason,digitSignature(o),now,scope,rid));
 if(fixedGroups!==undefined)ss.push(d.prepare(`UPDATE digit_fulfillments SET fixed_groups=? WHERE scope=? AND order_key=? AND ${guard}`).bind(fixedGroups,scope,o.key,scope,rid));
 ss.push(d.prepare(`DELETE FROM digit_fulfillment_rules WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
 for(const r of items)ss.push(d.prepare(`INSERT INTO digit_fulfillment_rules(scope,order_key,sales_code,stock_code,per_unit,allocated_qty) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(scope,o.key,o.code,r.stock_code,r.per_unit,r.allocated_qty??null,scope,rid));
 // The batch can contain several orders for the same sheet. Check the balance at
 // execution time, after preceding orders, so a stale browser cannot oversell.
 if(status!=='pending'&&status!=='print')ss.push(d.prepare(`UPDATE digit_fulfillments SET status='pending',reason=CASE WHEN EXISTS(SELECT 1 FROM digit_fulfillment_rules r LEFT JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code WHERE r.scope=digit_fulfillments.scope AND r.order_key=digit_fulfillments.order_key AND (s.code IS NULL OR s.archived=1)) THEN '对应版面库存已移除，请先建立对应库存' WHEN EXISTS(SELECT 1 FROM digit_fulfillment_rules r JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code WHERE r.scope=digit_fulfillments.scope AND r.order_key=digit_fulfillments.order_key AND s.quantity IS NULL) THEN '对应版面库存尚未盘点，请先盘点' ELSE '对应版面库存不足，请核对实际发货' END WHERE scope=? AND order_key=? AND EXISTS(SELECT 1 FROM digit_fulfillment_rules r LEFT JOIN physical_stocks s ON s.scope=r.scope AND s.code=r.stock_code WHERE r.scope=? AND r.order_key=? AND (s.code IS NULL OR s.archived=1 OR s.quantity IS NULL OR s.quantity<COALESCE(r.allocated_qty,?)*r.per_unit)) AND ${guard}`).bind(scope,o.key,scope,o.key,o.quantity,scope,rid));
}
export async function appendDigitImport(d:D1Database,ss:D1PreparedStatement[],scope:string,o:OrderLine,old:OrderLine|undefined,now:number,rid:string,guard:string,ignoreCutoff=false){
 const prior=await d.prepare('SELECT * FROM digit_fulfillments WHERE scope=? AND order_key=?').bind(scope,o.key).first<DigitFulfillment>();
 // A warehouse-confirmed print decision applies to the whole order line. ERP
 // status, remarks and quantity updates must never rebuild a stock recipe.
 if(prior?.status==='print'){
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND status='print' AND updated_at=?) THEN json('发货方式已更新，请刷新后重新导入') ELSE 1 END`).bind(scope,rid,scope,o.key,prior.updated_at));
  ss.push(d.prepare(`UPDATE digit_fulfillments SET signature=?,reason=?,updated_at=? WHERE scope=? AND order_key=? AND ${guard}`).bind(digitSignature(o),prior.signature===digitSignature(o)?prior.reason:'ERP备注、规格或数量已变化，请核对打印说明；仓库打印方式保留，不扣现货；打印成本待设置',now,scope,o.key,scope,rid));
  return null;
 }
 // A fixed-board override survives identical ERP imports. Any changed source
 // data requires manual review, even when no active deduction remains.
 if(prior?.fixed_groups){
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND updated_at=?) THEN json('实际发货规格已更新，请刷新后重新导入') ELSE 1 END`).bind(scope,rid,scope,o.key,prior.updated_at));
  if(prior.signature!==digitSignature(o))saveChoice(d,ss,scope,o,now,rid,guard,'pending',prior.color,'订单备注、规格或数量发生变化，请重新确认实际发货数字组；原扣减暂时保留',[],prior.fixed_groups);
  return old?.unit_cost_snapshot??null;
 }
 const state=await inputs(d,scope,o.code);
 if(old&&prior?.status==='pending'&&isValid(o.status)&&old.title===o.title&&old.quantity===o.quantity&&(o.shipped_at==null||o.shipped_at===old.shipped_at)&&digitSignature(o)===digitSignature(old)){
  const product=await d.prepare('SELECT * FROM products WHERE scope=? AND code=?').bind(scope,o.code).first<import('./model').Product>();
  if(historicalCounted(old,prior,product??undefined,state.rules,state.stocks,state.variants,state.conditions,state.remarkRules)){
   ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND status='pending' AND updated_at=?) THEN json('历史发货核对记录已变化') ELSE 1 END`).bind(scope,rid,scope,o.key,prior.updated_at));
   return old.unit_cost_snapshot??null;
  }
 }
 if(!state.rules.some(r=>r.sales_code===o.code&&state.variants.some(v=>v.base_code===r.stock_code)))return;
 const retryPending=prior?.status==='pending'&&isValid(o.status)&&!(await d.prepare('SELECT 1 FROM order_stocks WHERE scope=? AND order_key=? UNION ALL SELECT 1 FROM order_returns WHERE scope=? AND order_key=? LIMIT 1').bind(scope,o.key,scope,o.key).first());
 if(retryPending)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (NOT EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND status='pending' AND updated_at=?) OR EXISTS(SELECT 1 FROM order_stocks WHERE scope=? AND order_key=?) OR EXISTS(SELECT 1 FROM order_returns WHERE scope=? AND order_key=?)) THEN json('订单发货记录已变化，请刷新后重新导入') ELSE 1 END`).bind(scope,rid,scope,o.key,prior!.updated_at,scope,o.key,scope,o.key));
 if(prior&&!retryPending){
  if(prior.signature===digitSignature(o)&&((old?.shipped_qty??0)>0||!isValid(o.status))){
   if(prior.status==='pending')return null;
   const parts=(await d.prepare('SELECT stock_code,per_unit,allocated_qty FROM digit_fulfillment_rules WHERE scope=? AND order_key=?').bind(scope,o.key).all<DigitItem>()).results;
   return parts.length&&parts.every(r=>state.stocks.find(s=>s.code===r.stock_code)?.cost!=null)?parts.reduce((n,r)=>n+state.stocks.find(s=>s.code===r.stock_code)!.cost!*r.per_unit*(r.allocated_qty??o.quantity),0)/o.quantity:null;
  }
  if(prior.signature!==digitSignature(o)){
  // Keep already recorded consumption until the warehouse confirms a change.
  saveChoice(d,ss,scope,o,now,rid,guard,'pending',prior.color,'订单备注、规格或数量发生变化，请确认实际发货；原扣减暂时保留',[]);return null;
  }
 }
 const product=await d.prepare('SELECT name FROM products WHERE scope=? AND code=?').bind(scope,o.code).first<{name:string}>();
 const plan=fulfillmentPlan({...o,title:product?.name||o.title},state.rules,state.variants,state.stocks,undefined,state.conditions,state.remarkRules);
 await guardDigitConditions(d,ss,scope,rid,guard);await guardRemarkRules(d,ss,scope,rid,guard);
 if(plan?.status==='pending'&&plan.reason.startsWith('建议整单打印')){
  const sizes=new Set(state.variants.filter(v=>state.rules.some(r=>r.sales_code===o.code&&r.stock_code===v.base_code)).map(v=>v.size));
  const rules=new Set(state.conditions.filter(c=>c.enabled&&sizes.has(c.size)&&plan.allocations.some(a=>a.color===c.color)).map(c=>c.print_rule_id).filter(Boolean));
  if(rules.size===1)ss.push(d.prepare(`INSERT INTO print_rule_matches(scope,shop,order_id,code,rule_id,updated_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,shop,order_id,code) DO NOTHING`).bind(scope,o.shop,o.order_id,o.code,[...rules][0],now,scope,rid));
 }
 if(!plan)return;
 const already=old&&(old.shipped_qty??0)>0&&!retryPending;
 saveChoice(d,ss,scope,o,now,rid,guard,already?'pending':plan.status,plan.color,already?'历史订单需确认实际发货颜色；原扣减暂时保留':plan.reason,already?[]:plan.items);
 if(ignoreCutoff)ss.push(d.prepare(`UPDATE digit_fulfillments SET ignore_cutoff=1 WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
 return !already&&plan.status!=='pending'&&plan.items.every(r=>state.stocks.find(s=>s.code===r.stock_code)?.cost!=null)?plan.items.reduce((n,r)=>n+state.stocks.find(s=>s.code===r.stock_code)!.cost!*r.per_unit*(r.allocated_qty??o.quantity),0)/o.quantity:null;
}
export async function appendDigitAction(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action==='digit_color_setup'){
  const state=await inputs(d,scope),bases=state.stocks.filter(s=>!s.archived&&digitSheet(s));
  if(!bases.length)throw new Error('请先导入红底白字数字贴的版面资料');
  for(const base of bases){const sheet=digitSheet(base)!;
   for(const entry of DIGIT_CATALOG.filter(c=>c.size===sheet.size&&c.end>=sheet.start)){
    const code=entry.color===RED_COLOR?base.code:'DIGIT-'+sheet.size+'-'+String(DIGIT_CATALOG.filter(c=>c.size===sheet.size).findIndex(c=>c.color===entry.color)+1).padStart(2,'0')+'-'+sheet.start+'-'+sheet.end;
    if(entry.color!==RED_COLOR)ss.push(d.prepare(`INSERT INTO physical_stocks(scope,code,name,spec,quantity,count_at,cost,location,minimum,note,updated_at,unit) SELECT ?,?,?,?,NULL,NULL,NULL,'',10,?,?,'张' WHERE ${guard} ON CONFLICT(scope,code) DO NOTHING`).bind(scope,code,entry.color+sheet.size+'cm数字贴（'+sheet.start+'～'+sheet.end+'）',base.spec,'来源：数字贴备货.xlsx；沿用红底白字拼版；该颜色备货数字至'+entry.end+'；内部库存，实际数量和成本待盘点',now,scope,rid));
    ss.push(d.prepare(`INSERT INTO digit_stock_variants(scope,base_code,color,stock_code,size,start,end,available_end) SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,base_code,color) DO NOTHING`).bind(scope,base.code,entry.color,code,sheet.size,sheet.start,sheet.end,entry.end,scope,rid));
   }
  }
  // Existing orders must be reviewed, never silently reclassified on setup.
  ss.push(d.prepare(`INSERT INTO digit_fulfillments(scope,order_key,status,color,reason,signature,updated_at) SELECT o.scope,o.key,'pending','','已存在的数字贴订单，请确认实际发货颜色','',? FROM orders o WHERE o.scope=? AND EXISTS(SELECT 1 FROM stock_rules r JOIN digit_stock_variants v ON v.scope=r.scope AND v.base_code=r.stock_code WHERE r.scope=o.scope AND r.sales_code=o.code) AND ${guard} ON CONFLICT(scope,order_key) DO NOTHING`).bind(now,scope,scope,rid));
  return true;
 }
 if(b.action!=='digit_fulfillment'&&b.action!=='digit_recheck'&&b.action!=='digit_audit'&&b.action!=='digit_print')return false;
 const automatic=b.action==='digit_recheck';
 if(b.action!=='digit_print'&&await d.prepare('SELECT 1 FROM orders o JOIN print_jobs j ON j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id WHERE o.scope=? AND o.key=?').bind(scope,b.key).first())throw new Error('该订单已整单转打印，不能单独改为现货');
 const o=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,b.key).first<OrderLine&{updated_at:number}>();
 const f=await d.prepare('SELECT * FROM digit_fulfillments WHERE scope=? AND order_key=?').bind(scope,b.key).first<DigitFulfillment>();
 if(!o||!f||f.updated_at!==b.expected_at||digitSignature(o)!==b.signature)throw new Error('订单已更新，请刷新后重新确认');
 if(b.action==='digit_print'){
  if(!isValid(o.status)||o.review===1||(o.shipped_qty??0)>o.quantity)throw new Error('请先核对订单状态或数量，再安排整单打印');
  const note=typeof b.print_note==='string'?b.print_note.trim():'';
  if(!note||note.length>1000)throw new Error('请填写打印说明，最多1000字');
  if(await d.prepare('SELECT order_key FROM order_conflicts WHERE scope=? AND order_key=?').bind(scope,o.key).first())throw new Error('请先处理ERP订单数据冲突');
  if(await d.prepare('SELECT id FROM order_returns WHERE scope=? AND order_key=? LIMIT 1').bind(scope,o.key).first())throw new Error('这笔订单已有退货记录，请先核对库存流水');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (NOT EXISTS(SELECT 1 FROM digit_fulfillments f JOIN orders o ON o.scope=f.scope AND o.key=f.order_key WHERE f.scope=? AND f.order_key=? AND f.updated_at=? AND o.updated_at=?) OR EXISTS(SELECT 1 FROM order_returns WHERE scope=? AND order_key=?) OR EXISTS(SELECT 1 FROM order_conflicts WHERE scope=? AND order_key=?)) THEN json('订单已更新，请刷新后确认') ELSE 1 END`).bind(scope,rid,scope,o.key,f.updated_at,o.updated_at,scope,o.key,scope,o.key));
  saveChoice(d,ss,scope,o,now,rid,guard,'print',note,'仓库已安排全部打印；不扣现货库存；打印成本待设置',[]);
  // Reset only this line's outstanding consumption. Counts that already reset
  // consumption remain at zero and therefore cannot be added back twice.
  ss.push(d.prepare(`UPDATE order_stocks SET deducted_qty=0,reset=0,updated_at=? WHERE scope=? AND order_key=? AND ${guard}`).bind(now,scope,o.key,scope,rid));
  ss.push(d.prepare(`UPDATE orders SET unit_cost_snapshot=NULL,review=0,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(now,scope,o.key,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'order','安排打印',0,?,?,?,'份' WHERE ${guard}`).bind(scope,crypto.randomUUID(),o.code,'整单'+o.quantity+'份安排仓库打印；打印说明：'+note+'；已校正本订单仍有效的现货扣减；打印成本待设置',now,o.key,scope,rid));
  return true;
 }
 if(b.action==='digit_audit'){
  if(f.status!=='auto'||!isValid(o.status))throw new Error('仅复核已自动处理的有效订单');
  const state=await inputs(d,scope,o.code),product=await d.prepare('SELECT name FROM products WHERE scope=? AND code=?').bind(scope,o.code).first<{name:string}>(),plan=fulfillmentPlan({...o,title:product?.name||o.title},state.rules,state.variants,state.stocks.map(s=>({...s,quantity:Number.MAX_SAFE_INTEGER})),undefined,state.conditions,state.remarkRules);
  await guardDigitConditions(d,ss,scope,rid,guard);await guardRemarkRules(d,ss,scope,rid,guard);
  const recorded=(await d.prepare('SELECT v.color,COALESCE(r.allocated_qty,?) AS quantity FROM digit_fulfillment_rules r JOIN digit_stock_variants v ON v.scope=r.scope AND v.stock_code=r.stock_code WHERE r.scope=? AND r.order_key=?').bind(o.quantity,scope,o.key).all<ColorAllocation>()).results;
  const canonical=(items:ColorAllocation[])=>JSON.stringify([...new Map(items.map(a=>[a.color,a.quantity]))].sort((a,b)=>a[0].localeCompare(b[0])));
  if(!plan||plan.status==='auto'&&canonical(plan.allocations)===canonical(recorded))throw new Error('该订单的原分配与当前规则一致');
  const reason='已扣记录待复核：'+(plan.status==='pending'?plan.reason:'备注应分配为'+plan.color)+'；原扣减已保留，确认后才调整';
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND status='auto' AND updated_at=?) THEN json('订单已更新，请刷新') ELSE 1 END`).bind(scope,rid,scope,o.key,f.updated_at));
  // Flag the interpretation only. Keep both the recorded route and consumption
  // intact so review never adds stock back or deducts a different colour itself.
  ss.push(d.prepare(`UPDATE digit_fulfillments SET status='pending',reason=?,updated_at=? WHERE scope=? AND order_key=? AND ${guard}`).bind(reason,now,scope,o.key,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'order','备注复核',0,?,?,?,'份' WHERE ${guard}`).bind(scope,crypto.randomUUID(),o.code,reason,now,o.key,scope,rid));
  return true;
 }
 if(automatic&&f.fixed_groups)throw new Error('该订单已人工修改发货数字组，请人工确认，不能自动覆盖');
 if(automatic&&f.status!=='pending')throw new Error('该订单已经确认，无需重新识别');
 if(automatic&&!isValid(o.status))throw new Error('订单当前不是已发货或已完成，请人工核对');
 if(!isValid(o.status)&&!(o.shipped_qty??0))throw new Error('订单尚未发货，不扣现货库存');
 if(await d.prepare('SELECT order_key FROM order_conflicts WHERE scope=? AND order_key=?').bind(scope,o.key).first())throw new Error('请先处理ERP订单数据冲突');
 if(await d.prepare('SELECT id FROM order_returns WHERE scope=? AND order_key=? LIMIT 1').bind(scope,o.key).first())throw new Error('该订单已登记退货，请先核对库存流水，不能直接更换发货颜色');
 const groups=b.fixed_groups===undefined?savedFixedGroups(f.fixed_groups):b.fixed_groups;
 if(!Array.isArray(groups)||groups.some((c:unknown)=>typeof c!=='string'))throw new Error('实际发货数字组无效');
 if(automatic&&groups.length)throw new Error('修改发货数字组必须由仓库人工确认');
 const state=await inputs(d,scope,groups.length?undefined:o.code);
 const selected:string|ColorAllocation[]|undefined=automatic?undefined:Array.isArray(b.allocations)?b.allocations:b.color;
 if(!automatic&&(typeof selected!=='string'&&!Array.isArray(selected)||typeof selected==='string'&&!selected))throw new Error('请选择实际发货颜色');
 if(Array.isArray(selected)&&(selected.length>12||selected.some(a=>!a||typeof a.color!=='string'||!Number.isSafeInteger(a.quantity)||a.quantity<=0)))throw new Error('请填写有效的颜色和发货份数');
 const shipped=o.shipped_qty??o.quantity;
 // Add this order's own still-effective deduction back for a same-colour retry.
 const old=(await d.prepare('SELECT stock_code,deducted_qty FROM order_stocks WHERE scope=? AND order_key=?').bind(scope,o.key).all<{stock_code:string;deducted_qty:number}>()).results;
 if(automatic&&old.some(r=>r.deducted_qty>0))throw new Error('这笔订单已有扣减记录，请人工确认调整');
 const available=state.stocks.map(s=>({...s,quantity:s.quantity==null?null:s.quantity+(old.find(r=>r.stock_code===s.code)?.deducted_qty??0)}));
 const product=await d.prepare('SELECT name FROM products WHERE scope=? AND code=?').bind(scope,o.code).first<{name:string}>();
 const fixed=groups.length?fixedGroupPlan({...o,quantity:shipped},state.rules,state.variants,available,groups,selected as ColorAllocation[],state.conditions):null;
 const plan=fixed??fulfillmentPlan({...o,title:product?.name||o.title,quantity:shipped},state.rules,state.variants,available,selected,state.conditions,state.remarkRules);
 await guardDigitConditions(d,ss,scope,rid,guard);await guardRemarkRules(d,ss,scope,rid,guard);
 if(!plan)throw new Error('无法匹配该颜色版面');
 if(plan.status==='pending'){
  if(!automatic)throw new Error(plan.reason);
  saveChoice(d,ss,scope,o,now,rid,guard,'pending',plan.color,plan.reason,[]);return true;
 }
 const items=plan.items;
 if(fixed){
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=?) OR EXISTS(SELECT 1 FROM order_returns WHERE scope=? AND order_key=?) OR EXISTS(SELECT 1 FROM order_conflicts WHERE scope=? AND order_key=?)) THEN json('订单或售后记录已变化，请刷新后核对') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at,scope,o.key,scope,o.key));
  const originals=state.rules.filter(r=>r.sales_code===o.code);
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (SELECT COUNT(*) FROM stock_rules WHERE scope=? AND sales_code=?)!=? THEN json('原规格关联已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,o.code,originals.length));
  for(const r of originals)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM stock_rules WHERE scope=? AND sales_code=? AND stock_code=? AND per_unit=?) THEN json('原规格关联已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,o.code,r.stock_code,r.per_unit));
  for(const item of items){
   const v=state.variants.find(v=>v.stock_code===item.stock_code&&groups.includes(v.base_code))!,s=state.stocks.find(s=>s.code===item.stock_code)!;
   ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM digit_stock_variants v JOIN physical_stocks s ON s.scope=v.scope AND s.code=v.stock_code WHERE v.scope=? AND v.base_code=? AND v.color=? AND v.stock_code=? AND v.size=? AND v.start=? AND v.end=? AND v.available_end=? AND s.cost IS ? AND s.archived=0) THEN json('库存版面或成本已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,v.base_code,v.color,v.stock_code,v.size,v.start,v.end,v.available_end,s.cost));
  }
 }
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND updated_at=?) THEN json('订单已由其他人确认，请刷新') ELSE 1 END`).bind(scope,rid,scope,o.key,f.updated_at));
 // Restore only the consumption still attached to current count baselines.
 ss.push(d.prepare(`UPDATE order_stocks SET deducted_qty=0,reset=0,updated_at=? WHERE scope=? AND order_key=? AND ${guard}`).bind(now,scope,o.key,scope,rid));
 const reason=fixed?'仓库已确认实际发货数字组：'+fixed.label:automatic?plan.reason:'仓库已确认实际发货颜色及数量';
 saveChoice(d,ss,scope,o,now,rid,guard,automatic?'auto':'manual',plan.color,reason,items,groups.length?JSON.stringify(groups):'');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND status='pending') THEN json('库存已变化，请刷新后重新确认') ELSE 1 END`).bind(scope,rid,scope,o.key));
 const actualCost=items.every(r=>state.stocks.find(s=>s.code===r.stock_code)?.cost!=null)?items.reduce((n,r)=>n+state.stocks.find(s=>s.code===r.stock_code)!.cost!*r.per_unit*(r.allocated_qty??shipped),0)/shipped:null;
 ss.push(d.prepare(`UPDATE orders SET unit_cost_snapshot=?,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(actualCost,now,scope,o.key,scope,rid));
 ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'order','确认发货颜色',0,?,?,?,'份' WHERE ${guard}`).bind(scope,crypto.randomUUID(),o.code,'订单 '+o.order_id+'；原购买规格：'+o.spec+'；'+reason+'；'+plan.color+'；'+items.map(r=>r.stock_code+' × '+r.per_unit*(r.allocated_qty??shipped)).join('；')+'；货品总成本：'+(actualCost==null?'待填写':(actualCost*shipped).toFixed(4)+'元'),now,o.key,scope,rid));
 return true;
}
