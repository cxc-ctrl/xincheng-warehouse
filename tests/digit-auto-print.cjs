const {assert,load,root}=require('./isolated-harness.cjs'),path=require('node:path');
const {fulfillmentPlan}=load(path.join(root,'lib/digit-colors.ts'));
const o={code:'D',title:'红底白字15cm数字贴（1～10）',spec:'直径15厘米1～10各1个',quantity:1,remarks_available:1,buyer_remark:'蓝底白字',seller_remark:''};
const rules=[{sales_code:'D',stock_code:'BASE',per_unit:1}],variants=[{base_code:'BASE',stock_code:'RED',color:'红底白字',size:15,start:1,end:10,available_end:100},{base_code:'OTHER',stock_code:'BLUE',color:'蓝底白字',size:15,start:1,end:2,available_end:100}],conditions=[{color:'红底白字',size:15,start:1,end:100,enabled:1},{color:'蓝底白字',size:15,start:1,end:100,enabled:1}];
let p=fulfillmentPlan(o,rules,variants,[],undefined,conditions);assert.equal(p.status,'print');assert.equal(p.items.length,0);
p=fulfillmentPlan({...o,buyer_remark:'红底白字'},rules,variants,[{code:'RED',name:'红版',quantity:0}],undefined,conditions);assert.equal(p.status,'pending','shortage is not missing-board printing');
p=fulfillmentPlan({...o,buyer_remark:'不确定颜色'},rules,variants,[],undefined,conditions);assert.equal(p.status,'pending');
console.log('PASS missing boards print; shortage and unclear remarks remain pending');
