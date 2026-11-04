/** Automatically collect product-center digital-print lines for accounting only.
 * Each receipt commits the order, membership and cost-review marker atomically.
 * Existing whole-order transfers and historical inventory deductions are retained.
 */
type Group={shop:string;order_id:string};
function eligible(scope:string,g:Group){return {sql:`SELECT o.key FROM orders o JOIN product_supply_profiles p ON p.scope=o.scope AND p.code=o.code
 WHERE o.scope=? AND o.shop=? AND o.order_id=? AND json_extract(p.config,'$.variant.supply_mode')='打印定制'
 AND o.status IN ('待发货','已付款','已发货','已完成','已关闭','已取消') AND o.deducted_qty=0
 AND NOT EXISTS(SELECT 1 FROM order_stocks s WHERE s.scope=o.scope AND s.order_key=o.key AND s.deducted_qty>0)
 AND NOT EXISTS(SELECT 1 FROM order_returns r WHERE r.scope=o.scope AND r.order_key=o.key)`,args:[scope,g.shop,g.order_id]};}
function members(scope:string,g:Group){const q=eligible(scope,g);return {sql:`SELECT json_group_array(key) FROM (SELECT key FROM (${q.sql}) UNION SELECT value AS key FROM print_jobs j,json_each(j.member_keys) WHERE j.scope=? AND j.shop=? AND j.order_id=? AND j.accounting_mode='sku' AND j.cost_cents IS NOT NULL AND j.cost_source!='rule' ORDER BY key)`,args:[...q.args,scope,g.shop,g.order_id]};}
export async function appendAutoPrintAccounting(d:D1Database,scope:string,groups:Group[],now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 for(const g of new Map(groups.map(g=>[JSON.stringify([g.shop,g.order_id]),g])).values()){
  const q=eligible(scope,g),m=members(scope,g),args=[scope,g.shop,g.order_id];
  ss.push(d.prepare(`INSERT INTO print_jobs(scope,shop,order_id,note,basis,created_at,updated_at,accounting_mode,member_keys)
   SELECT ?,?,?,'产品中心数码打印自动归集；实际生产由前端打印部门负责','',COALESCE((SELECT MIN(order_time) FROM orders WHERE scope=? AND shop=? AND order_id=?),?),?,'sku',(${m.sql})
   WHERE EXISTS(${q.sql}) AND ${guard} ON CONFLICT(scope,shop,order_id) DO NOTHING`).bind(...args,...args,now,now,...m.args,...q.args,scope,rid));
  ss.push(d.prepare(`UPDATE digit_fulfillments SET status='pending',reason='商品制作方式已更新，请按当前仓库规则核对',updated_at=?
   WHERE scope=? AND reason='产品中心数码打印自动归入核算，无需仓库安排生产' AND order_key IN(SELECT o.key FROM orders o JOIN print_jobs j ON j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id WHERE o.scope=? AND o.shop=? AND o.order_id=? AND j.accounting_mode='sku') AND order_key NOT IN(${m.sql}) AND ${guard}`).bind(now,scope,...args,...m.args,scope,rid));
  ss.push(d.prepare(`UPDATE print_jobs SET needs_review=CASE WHEN cost_cents IS NOT NULL AND member_keys<>(${m.sql}) THEN 1 ELSE needs_review END,
   updated_at=CASE WHEN member_keys<>(${m.sql}) THEN ? ELSE updated_at END,member_keys=(${m.sql})
   WHERE scope=? AND shop=? AND order_id=? AND accounting_mode='sku' AND ${guard}`).bind(...m.args,...m.args,now,...m.args,...args,scope,rid));
  const membership=`SELECT value FROM print_jobs j,json_each(j.member_keys) WHERE j.scope=? AND j.shop=? AND j.order_id=? AND j.accounting_mode='sku'`;
  ss.push(d.prepare(`UPDATE digit_fulfillments SET status='print',reason='产品中心数码打印自动归入核算，无需仓库安排生产',updated_at=? WHERE scope=? AND order_key IN(${membership}) AND ${guard}`).bind(now,scope,...args,scope,rid));
  // Preserve pre-existing ERP/reference cost snapshots for audit. Accounting
  // enrichment uses the separately confirmed printing cost for these lines.
 }
}
