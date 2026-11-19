const {assert,load,root,line}=require('./isolated-harness.cjs');
const {describeOrderConflict}=load(root+'/lib/order-conflict-review.ts');
const {indexOrderFilters,filterReviewOrders}=load(root+'/lib/order-review-filters.ts');
const at=Date.now()-60000,base={...line('A','SKU',1,'已发货',at),shipped_qty:1,shipped_at:at+1000,cost:.65};
function review(old,next){return describeOrderConflict(old,{order_key:old.key,payload:JSON.stringify(next),reason:'legacy generic message',fingerprint:'',created_at:at});}
const a=review(base,{...base,status:'已关闭'});assert.equal(a.category,'conflict_after_sale');assert.match(a.instruction,/实际收到退货/);assert.equal(a.changes[0].before,'已发货');assert.equal(a.changes[0].after,'已关闭');
const cost=review(base,{...base,cost:1});assert.equal(cost.category,'conflict_cost');assert.equal(cost.changes[0].before,'¥0.65');assert.equal(cost.changes[0].after,'¥1.00');
const pending={...base,status:'未发货',shipped_at:null,shipped_qty:0,cost:8},shipped=review(pending,{...base,cost:11});assert.equal(shipped.category,'conflict_shipment');assert.equal(shipped.changes.length,3);assert.match(shipped.label,/成本/);assert(shipped.changes.some(c=>c.field==='发货时间'&&c.before==='未提供'));
const clock=review(base,{...base,shipped_at:at+2000});assert.equal(clock.category,'conflict_time');assert.match(clock.instruction,/盘点/);
const multiple=review(base,{...base,quantity:2,cost:2});assert.equal(multiple.category,'conflict_other');assert.equal(multiple.changes.length,2);assert.match(multiple.instruction,/数量/);
assert.equal(describeOrderConflict(base,{payload:'broken'}).category,'conflict_other');assert.equal(describeOrderConflict(base,{payload:'null'}).category,'conflict_other');
const orders=[base,{...base,key:'B'},{...base,key:'C'},{...base,key:'D'}],conflicts=new Map(orders.map((o,i)=>[o.key,[a,shipped,cost,clock][i]]));
const idx=indexOrderFilters(orders,new Map(),new Map(),new Map([['SKU',{}]]),new Set(orders.map(o=>o.key)),conflicts);assert.equal(idx.counts.pending,4);assert.equal(idx.counts.other,0);for(const id of ['conflict_after_sale','conflict_shipment','conflict_cost','conflict_time']){assert.equal(idx.counts[id],1);assert.equal(filterReviewOrders(idx.rows,[id],'').length,1);}
assert.equal(idx.counts.all,4);assert.equal(idx.counts.valid,4);
console.log('PASS per-field before/after, actionable checks, combined shipment/cost, refund-safe wording, malformed payloads, exclusive classification and filter counts');
