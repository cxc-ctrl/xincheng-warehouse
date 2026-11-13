const {assert,sql,send,product,line,imported,qty}=require('./isolated-harness.cjs');
(async()=>{
 const at=Date.now()-60000;await product('DIGIT','红底白字15cm数字贴（1～4）');await product('STOCK','普通现货');
 for(const code of ['R1','R2','B1','NORMAL']){await send({action:'physical_product',new_product:true,product:{code,name:code,unit:'张',cost:1}});sql.prepare('update physical_stocks set quantity=100,count_at=? where code=?').run(at,code);}
 await send({action:'stock_rule',sales_codes:['DIGIT'],items:[{stock_code:'R1',per_unit:1},{stock_code:'R2',per_unit:1}],at});
 await send({action:'stock_rule',sales_codes:['STOCK'],items:[{stock_code:'NORMAL',per_unit:1}],at});
 for(const [base,color,stock,start,end] of [['R1','红底白字','R1',1,2],['R2','红底白字','R2',3,4],['R1','蓝底白字','B1',1,2]])sql.prepare("insert into digit_stock_variants values('isolated',?,?,?,?,?,?,?)").run(base,color,stock,15,start,end,100);
 const a={...line('MIX','DIGIT',1,'已发货',at+2000),spec:'直径15厘米1～4各1个',buyer_remark:'蓝底白字',seller_remark:'',remarks_available:1,shipped_at:at+3000},b={...line('MIX','STOCK',1,'已发货',at+2000),shipped_at:at+3000};
 await imported([a,b]);const f=sql.prepare('select * from digit_fulfillments where order_key=?').get(a.key);assert.equal(f.status,'print');assert.equal(qty('NORMAL'),99);assert.equal(qty('B1'),100);assert.equal(qty('R1'),100);
 const j=sql.prepare("select * from print_jobs where order_id='MIX'").get();assert.deepEqual(JSON.parse(j.member_keys),[a.key]);assert.equal(j.cost_cents,null,'unconfigured print cost remains missing, never zero');
 await imported([a,b]);assert.equal(qty('NORMAL'),99);assert.equal(qty('B1'),100);
 console.log('PASS mixed order automatic print membership, normal stock deduction, missing-cost marker, reimport idempotency');
})().catch(e=>{console.error(e);process.exitCode=1});
