const {assert,sql,db,load,route,model,send,data,product,imported,line,root}=require('./isolated-harness.cjs');
const {dashboardSummary}=load(root+'/lib/warehouse-views.ts');
const {forecastStock}=load(root+'/lib/product-report.ts');
const {cutoffTime}=load(root+'/lib/order-policy.ts');
const {printBasis}=load(root+'/lib/printing.ts');
async function get(view,key){const r=await route.GET(new Request('http://isolated.test/api/warehouse?view='+view+(key?'&key='+encodeURIComponent(key):'')));assert.equal(r.status,200);return r.json();}
function baseline(d,now){const smap=new Map(d.physical.map(s=>[s.code,s])),ps=d.products.map(p=>model.recipeStock(p,d.rules,smap)),w=model.warehouseCatalog(d.products,d.physical,d.rules),states=w.products.map(p=>model.stockReadiness(p,d.rules,smap)),stats=model.summarize(ps,d.orders,30,now),pending=new Set(d.digitFulfillments.filter(f=>f.status==='pending').map(f=>f.order_key)),conflicts=new Set(d.conflicts.map(c=>c.order_key));return {skuCount:w.products.length,categories:new Set(w.products.map(p=>p.category)).size,counted:stats.counted,link:states.filter(s=>s.label==='待关联'||s.label==='关联需修复').length,count:states.filter(s=>s.label.includes('盘点')).length,uncounted:model.inventoryLedger(d.products,d.physical,d.rules).filter(r=>r.quantity==null).length,qty:stats.qty,orderCount:d.orders.length,reviews:d.orders.filter(o=>o.review===1||o.fulfillment_mode!=='print'&&pending.has(o.key)&&(o.shipped_qty??0)>0||conflicts.has(o.key)||cutoffTime(o,d.products,d.physical,d.rules,d.importTestMode)!=null).length,alerts:forecastStock(d.products,d.physical,d.rules,d.orders,{now}).filter(r=>r.warning&&!r.ignore_warning).length,top:[...stats.sales].filter(([,s])=>s.qty>0).sort((a,b)=>b[1].qty-a[1].qty).slice(0,5).map(([code,s])=>({code,name:ps.find(p=>p.code===code)?.name||code||'未填编码',qty:s.qty}))};}
(async()=>{
 const at=Date.now()-60000;
 await send({action:'physical_product',new_product:true,product:{code:'BOARD',name:'红底白字5cm数字贴（1～20）',quantity:100,count_at:at,cost:.3}});
 await product('SALE','红底白字5cm数字贴（1～10）');await send({action:'stock_rule',sales_codes:['SALE'],items:[{stock_code:'BOARD',per_unit:1}],effective_at:at});await send({action:'digit_color_setup'});
 await product('UNLINKED','未关联');await send({action:'product',new_product:true,product:{code:'DIRECT',name:'独立库存',stock_mode:'direct',quantity:20,count_at:at,cost:2}});
 await imported([{...line('stock','SALE',2,'已发货',at+1000),remarks_available:true},{...line('review','SALE',1,'已发货',at+1000),buyer_remark:'看图',remarks_available:true},{...line('print','DIRECT',4,'已发货',at+1000),remarks_available:true}]);
 sql.prepare("UPDATE digit_fulfillment_rules SET allocated_qty=1 WHERE scope='isolated' AND order_key IN(SELECT key FROM orders WHERE order_id='stock')").run();
 let full=await data();const lines=full.orders.filter(o=>o.order_id==='print');await send({action:'print_transfer',shop:'isolated',order_id:'print',basis:printBasis(lines),updated_at:0,note:'打印',quick:true});
 full=await data();const snapshot=JSON.stringify(full),dashboard=await get('dashboard'),lean=await get('products'),now=dashboard.dashboard.asOf;
 const actual={...dashboard.dashboard};delete actual.asOf;delete actual.movements;assert.deepEqual(actual,baseline(full,now));
 assert(!dashboard.products&&!dashboard.orders&&!dashboard.printJobs);assert(Buffer.byteLength(JSON.stringify(dashboard))<15000);
 for(const o of lean.orders){const old=full.orders.find(x=>x.key===o.key);assert.equal(o.fulfillment_mode,old.fulfillment_mode||'stock');assert.deepEqual(o.stock_items,old.stock_items);}
 assert(!lean.printJobs&&!lean.freightBills&&!lean.shopAssignments);assert.equal(lean.products.length,full.products.length);
 const one=await get('order',full.orders.find(o=>o.order_id==='review').key);assert(one.orderRefresh.orders.every(o=>o.order_id==='review'));assert(one.digitVariants.length>0);
 for(const view of ['paper','purchasing','digitRules','history','shops','import','printing','analysis','freightCheck','inventoryExport'])await get(view);
 assert.equal(JSON.stringify(await data()),snapshot,'read-only page loading cannot change cost snapshots, stock, orders or events');
 const bad=await route.GET(new Request('http://isolated.test/api/warehouse?view=wrong'));assert.equal(bad.status,400);
 console.log('PASS: dashboard parity, shared/digit/direct/print routes, scoped order review, all module views, small summary and read-only data invariance');
})();
module.exports={baseline};
