const {assert,load,root}=require('./isolated-harness.cjs'),path=require('node:path');
const {shopSummaries}=load(path.join(root,'lib/shop-summary.ts'));
const row=(platform,shop,net,goods)=>({policy:{name:shop,kind:'own'},base:{shop,lines:[{platform}],net,goods,packing:0,freight:null,profit:null},shopProfit:null});
const groups=shopSummaries([row('TB','A',100,30),row('TB','A',200,null),row('TB','B',50,10),row('PDD','A',20,5)],'company');
assert.equal(groups.length,3);const a=groups.find(g=>g.platform==='TB'&&g.code==='A');assert.equal(a.rows.length,2);assert.deepEqual(a.net,{amount:300,missing:0});assert.deepEqual(a.goods,{amount:30,missing:1});assert.deepEqual(a.freight,{amount:null,missing:2});assert.deepEqual(a.packing,{amount:0,missing:0});assert.equal(groups.reduce((n,g)=>n+g.rows.length,0),4);assert.deepEqual(shopSummaries([],'own'),[]);
console.log('PASS per-platform shop grouping, full totals before detail pagination, unknown versus zero and empty filters');
