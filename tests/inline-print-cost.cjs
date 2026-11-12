const {assert,sql,load,root,send,imported,data,line}=require('./isolated-harness.cjs'),path=require('node:path');
const {printBasis,printCostNeedsReview}=load(path.join(root,'lib/printing.ts'));
const {isUnmatchedOrder}=load(path.join(root,'lib/order-review-filters.ts'));
const {buildFreightAnalysis}=load(path.join(root,'lib/freight-reconciliation.ts'));
(async()=>{
 sql.prepare("INSERT INTO import_ignore_rules VALUES('isolated','scent-test','XLXH-HM-XK','prefix','香卡',1,0,0)").run();
 const at=Date.now()-10000,o={...line('LEGACY','UNKNOWN',2,'已发货',at),cost:99,source_updated_at:at};await imported([o]);
 const b={action:'print_transfer',shop:o.shop,order_id:o.order_id,basis:printBasis([o]),updated_at:0,note:'老商品整单货品成本',total_cost:'3.50',request_id:'inline-once'};
 await send({...b,total_cost:''},400);assert.equal(sql.prepare('select count(*) n from print_jobs').get().n,0,'invalid cost rolls back transfer');
 await send(b);await send(b);let d=await data(),j=d.printJobs[0],printed=d.orders.find(r=>r.key===o.key);assert.equal(j.cost_cents,350);assert.equal(j.cost_source,'manual');assert.equal(printed.printing_allocated_cost,3.5);assert(!isUnmatchedOrder(printed,new Map()));
 assert.equal(buildFreightAnalysis(d.orders,d).rows[0].goods,350,'manual goods cost replaces ERP cost, once');
 await imported([o]);d=await data();assert.equal(d.printJobs[0].cost_cents,350);assert.equal(d.printJobs[0].needs_review,0);
 await imported([{...o,quantity:3,source_updated_at:at+5000}]);d=await data();assert.equal(d.printJobs[0].cost_cents,350);assert(printCostNeedsReview(d.printJobs[0],d.orders));
 const zero=line('ZERO','UNKNOWN2',1,'已发货',at);await imported([zero]);const zb={...b,request_id:'zero',order_id:zero.order_id,basis:printBasis([zero]),total_cost:'0'};await send(zb,400);await send({...zb,confirm_zero_cost:true});
 const a=line('MIX','XLXH-HM-XK-HH',1,'已发货',at),normal=line('MIX','OTHER',1,'已发货',at);await imported([a,normal]);await imported([a]);d=await data();assert(!d.orders.some(r=>r.code.startsWith('XLXH-HM-XK')));assert(d.orders.some(r=>r.code==='OTHER'));assert.equal(sql.prepare('select count(*) n from ignored_order_lines').get().n,1);assert(buildFreightAnalysis(d.orders,d).rows.find(r=>r.order_id==='MIX').reasons.some(r=>r.includes('暂不纳入')));
 assert.equal(sql.prepare('select count(*) n from order_stocks').get().n,0);
 console.log('PASS atomic inline cost, retry idempotency, manual cost priority, ERP change review, zero confirmation, scoped scent-card ignores and mixed financial guard');
})().catch(e=>{console.error(e);process.exitCode=1});
