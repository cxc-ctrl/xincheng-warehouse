const {assert,sql,load,root,send,product,imported,line,qty}=require('./isolated-harness.cjs'),path=require('node:path');
const {orderFingerprint}=load(path.join(root,'lib/order-policy.ts'));
const {returnPlan}=load(path.join(root,'lib/return-plan.ts'));
(async()=>{
 const at=Date.now()-60000;await product('RETURN','15cm数字贴1-10');
 const codes=Array.from({length:5},(_,i)=>'S'+i);
 for(const code of codes){await send({action:'physical_product',new_product:true,product:{code,name:code,unit:'张',cost:1}});sql.prepare("update physical_stocks set quantity=10,count_at=? where code=?").run(at,code);}
 await send({action:'stock_rule',sales_codes:['RETURN'],items:codes.map(code=>({stock_code:code,per_unit:1})),at});
 const o={...line('RETURN-ORDER','RETURN',2,'已发货',at+1000),shipped_at:at+2000};await imported([o]);assert.equal(qty('S0'),8);
 const current=()=>sql.prepare('select * from orders where key=?').get(o.key);
 const body={action:'order_review',mode:'return',key:o.key,fingerprint:orderFingerprint(current()),items:codes.map(code=>({kind:'physical',code,quantity:1})),note:'整套退回',operator:'测试仓管',at:at+3000,request_id:'return-one-set'};
 await send(body);assert(codes.every(code=>qty(code)===9));await send(body);assert.equal(qty('S0'),9,'same receipt is idempotent');
 await send({...body,request_id:'damage',fingerprint:orderFingerprint(current()),items:[{kind:'physical',code:'S0',quantity:0,damaged:1}]});assert.equal(qty('S0'),9,'damaged return does not decrement or increment');
 await send({...body,request_id:'over-return',fingerprint:orderFingerprint(current()),items:[{kind:'physical',code:'S0',quantity:1}]},400);
 const record=sql.prepare("select * from inventory_entries where id='return-one-set'").get();assert.equal(JSON.parse(record.items).length,5);
 const other={action:'inventory_entry',request_id:'other-one',items:[{kind:'physical',code:'S0',quantity:5}],note:'打印转备货',operator:'测试仓管',at:at+5000};await send(other);await send(other);assert.equal(qty('S0'),14);
 await send({...other,request_id:'bad-time',at:at-1},400);assert.equal(qty('S0'),14);
 await send({...other,request_id:'duplicate',items:[...other.items,...other.items]},400);assert.equal(qty('S0'),14,'invalid multi-line receipt atomic');
 const remaining=returnPlan({...current(),stock_items:codes.map(stock_code=>({stock_code,per_unit:1,quantity:2}))},[{code:'RETURN',stock_mode:'recipe'}],codes.map(code=>({code,unit:'张'})),[],sql.prepare('select * from order_returns').all());assert.equal(remaining[0].max,0);
 await send({action:'purchase_create',request_id:'purchase-test',kind:'physical',code:'S1',quantity:3,amount:3,supplier:'测试',note:'测试采购'});await send({action:'purchase_receive',id:'purchase-test',request_id:'receive-test'});assert.equal(qty('S1'),12);assert.equal(sql.prepare("select type from inventory_entries where id='receive-test'").get().type,'采购入库');
 console.log('PASS five-board return, partial return, damaged return, caps, idempotency, other receipt, atomic rejection');
})().catch(e=>{console.error(e);process.exitCode=1});
