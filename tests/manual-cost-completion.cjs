const {assert,sql,load,root,send,data,imported,line,route}=require('./isolated-harness.cjs');
const {stockCostBasis}=load(root+'/lib/manual-stock-cost.ts');const {isUnmatchedOrder,indexOrderFilters}=load(root+'/lib/order-review-filters.ts');
(async()=>{
 const at=Date.now()-60000,a={...line('A','NO-CATALOG',6,'已发货',at),shipped_at:at+1000},b={...line('B','NO-CATALOG',2,'已发货',at),shipped_at:at+1000};await imported([a,b]);
 const get=()=>sql.prepare('select * from orders where key=?').get(a.key);
 const payload={action:'manual_stock_cost',request_id:'finish-cost',key:a.key,cost:'.50',basis:stockCostBasis(get()),cost_at:0};
 // The UI number field sends 0.50; omit the optional note entirely.
 payload.cost='0.50';await send(payload);await send(payload);
 const d=await data(),current=d.orders.find(o=>o.key===a.key);assert.equal(current.manual_stock_cost_cents,50);assert.equal(current.manual_stock_cost_note,'');assert.equal(current.deducted_qty,0);
 assert(!isUnmatchedOrder(current,new Map()));assert(isUnmatchedOrder(d.orders.find(o=>o.key===b.key),new Map()),'Same SKU in other orders stays unresolved');
 const index=indexOrderFilters(d.orders,new Map(),new Map(),new Map(),new Set());assert.equal(index.counts.cost,1);assert.equal(index.counts.unmatched,1);assert.equal(index.counts.all,2);
 const response=await route.GET(new Request('http://isolated.test/api/warehouse?view=dashboard'));assert.equal((await response.json()).dashboard.unmatched,1,'Dashboard agrees with order list');
 await imported([a,b]);const again=(await data()).orders.find(o=>o.key===a.key);assert(!isUnmatchedOrder(again,new Map()),'Identical ERP import retains completion');
 sql.prepare('update orders set quantity=7 where key=?').run(a.key);assert(isUnmatchedOrder(get(),new Map()),'Quantity changes reopen unresolved cost');
 await send({action:'manual_stock_cost',key:a.key,cost:'0',basis:stockCostBasis(get()),cost_at:get().manual_stock_cost_at,confirm_zero:true});assert(!isUnmatchedOrder(get(),new Map()),'Confirmed zero is a valid resolved cost');
 assert.equal(sql.prepare('select count(*) n from stock_cost_events').get().n,2);assert.equal(sql.prepare('select count(*) n from order_returns').get().n,0);
 console.log('PASS optional note, submitted-cost queue completion, all-order retention, per-line isolation, dashboard parity, reimport persistence, stale cost reopening and zero handling');
})().catch(e=>{console.error(e);process.exitCode=1});
