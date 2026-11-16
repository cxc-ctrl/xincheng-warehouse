import {cents} from './freight-reconciliation';
import {stockCostBasis} from './manual-stock-cost';
import type {OrderLine} from './model';

export async function appendManualStockCost(b:Record<string,any>,d:D1Database,scope:string,operator:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='manual_stock_cost')return false;
 const o=await d.prepare('SELECT * FROM orders WHERE scope=? AND key=?').bind(scope,b.key).first<OrderLine&{updated_at:number}>();
 if(!o)throw Error('订单不存在，请刷新');
 const value=cents(b.cost,'本条商品总成本'),note=typeof b.note==='string'?b.note.trim():'';
 if(!note||note.length>1000)throw Error('请填写成本说明（最多1000字）');
 if(value===0&&b.confirm_zero!==true)throw Error('请确认本条商品成本确实为0元');
 if(b.basis!==stockCostBasis(o)||(b.cost_at??0)!==(o.manual_stock_cost_at??0))throw Error('订单或人工成本已更新，请刷新后重新核对');
 const blocked=`EXISTS(SELECT 1 FROM digit_fulfillments f WHERE f.scope=orders.scope AND f.order_key=orders.key AND f.status='print') OR EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=orders.scope AND j.shop=orders.shop AND j.order_id=orders.order_id AND (j.accounting_mode!='sku' OR EXISTS(SELECT 1 FROM json_each(j.member_keys) WHERE value=orders.key))) OR EXISTS(SELECT 1 FROM order_conflicts c WHERE c.scope=orders.scope AND c.order_key=orders.key) OR EXISTS(SELECT 1 FROM import_conflict_groups c WHERE c.scope=orders.scope AND c.order_key=orders.key AND c.status='pending')`;
 if(await d.prepare(`SELECT 1 FROM orders WHERE scope=? AND key=? AND (${blocked})`).bind(scope,o.key).first())throw Error('打印商品请填写打印成本；有导入冲突时请先完成核对');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=? AND manual_stock_cost_at=? AND NOT (${blocked})) THEN json('订单或成本已变化，请刷新重试') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at,o.manual_stock_cost_at??0));
 ss.push(d.prepare(`INSERT INTO stock_cost_events(scope,id,order_key,previous_cents,cost_cents,basis,note,operator,at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,rid,o.key,o.manual_stock_cost_cents??null,value,stockCostBasis(o),note,operator,now,scope,rid));
 ss.push(d.prepare(`UPDATE orders SET manual_stock_cost_cents=?,manual_stock_cost_basis=?,manual_stock_cost_note=?,manual_stock_cost_operator=?,manual_stock_cost_at=?,updated_at=? WHERE scope=? AND key=? AND ${guard}`).bind(value,stockCostBasis(o),note,operator,now,now,scope,o.key,scope,rid));
 return true;
}
