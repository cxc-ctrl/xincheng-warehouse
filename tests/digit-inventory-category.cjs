const {assert,load,root}=require('./isolated-harness.cjs'),path=require('node:path');
const {buildBusinessAnalysis,DEFAULT_ANALYTICS}=load(path.join(root,'lib/business-analysis.ts'));
const now=Date.now(),stocks=[{code:'D',name:'蓝底白字1cm数字贴（1～150）',quantity:10,cost:0.5},{code:'C',name:'生日贺卡',quantity:5,cost:2}].map(s=>({...s,unit:'张',spec:'',count_at:now,minimum:0,note:'',location:'',updated_at:now}));
const result=buildBusinessAnalysis([],stocks,[],[],{analyticsSettings:DEFAULT_ANALYTICS,productLifecycle:[],inventoryReceipts:[]},now,{start:now-1,end:now+1});
assert.equal(result.stockRows[0].category,'贴纸');assert.deepEqual(result.stockRows[0].categories,['贴纸']);assert.equal(result.stockRows[1].category,'未分类');assert(result.stockRows[1].categories.includes('未分类'));assert.equal(result.stockRows.reduce((s,r)=>s+r.value,0),15);assert.equal(stocks[0].quantity,10);
console.log('PASS digit board category/filter, other stock unchanged and total valuation preserved');
