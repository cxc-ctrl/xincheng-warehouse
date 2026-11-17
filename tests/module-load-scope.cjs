const {assert,route,send,product,imported,line,data,sql}=require('./isolated-harness.cjs');
(async()=>{
 await product('TEST','页面加载测试');await imported([line('O','TEST',1,'已发货',Date.now()-1000)]);
 const before=JSON.stringify(await data());
 const get=async view=>{const r=await route.GET(new Request('http://isolated.test/api/warehouse?view='+view));assert.equal(r.status,200);return r.json()};
 const shops=await get('shops');assert.deepEqual(shops.shopAssignments,[]);assert(Array.isArray(shops.shopConfigs));
 const full=await data(),orders=await get('import'),analysis=await get('analysis');
 assert.deepEqual(orders.orders,full.orders,'Order quantities, remarks, routes and costs remain intact');assert.deepEqual(analysis.orders,full.orders,'Financial analysis keeps original enriched order costs');
 assert(!orders.printJobs&&!analysis.printJobs&&!orders.digitOrderRules&&!analysis.digitOrderRules);
 assert.deepEqual(analysis.shopAssignments,full.shopAssignments,'Analysis retains pricing assignments');
 assert(orders.products.every(p=>p.images.length===0));
 assert.equal(JSON.stringify(await data()),before,'Page reads cannot change orders, costs, stock or audits');
 console.log('PASS lean shop/order/analysis payloads, complete finance inputs and read-only invariance');
})().catch(e=>{console.error(e);process.exitCode=1});
