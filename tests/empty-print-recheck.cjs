const {assert,sql,load,root,db,send,product,imported,data,line}=require('./isolated-harness.cjs'),path=require('node:path');
const {readHistoricalCountedKeys}=load(path.join(root,'lib/historical-counted-orders.ts'));
const {digitOrderIssue}=load(path.join(root,'lib/order-issues.ts'));
const {indexOrderFilters}=load(path.join(root,'lib/order-review-filters.ts'));
(async()=>{
 const at=Date.now()-20000;await product('OLD','红底白字1cm数字贴（1～10）');
 await send({action:'physical_product',new_product:true,product:{code:'BOARD',name:'红底白字1cm数字贴（1～150）',unit:'张',cost:.5}});
 await send({action:'stock_rule',sales_codes:['OLD'],items:[{stock_code:'BOARD',per_unit:1}],at});await send({action:'digit_color_setup'});
 const o={...line('HIST','OLD',1,'已发货',at),spec:'1～10',remarks_available:1,buyer_remark:'',seller_remark:'',shipped_at:at+1000};await imported([o]);
 sql.prepare("insert into print_jobs(scope,shop,order_id,note,basis,created_at,updated_at,accounting_mode,member_keys) values('isolated',?,?,'','',1,1,'sku','[]')").run(o.shop,o.order_id);let choice=sql.prepare('select * from digit_fulfillments where order_key=?').get(o.key);await send({action:'digit_recheck',key:o.key,expected_at:choice.updated_at,signature:choice.signature});sql.prepare("update print_jobs set member_keys=?").run(JSON.stringify([o.key]));
choice=sql.prepare('select * from digit_fulfillments where order_key=?').get(o.key);
await send({action:'digit_recheck',key:o.key,expected_at:choice.updated_at,signature:choice.signature},400);
sql.prepare("update print_jobs set accounting_mode='whole',member_keys='[]'").run();
await send({action:'digit_recheck',key:o.key,expected_at:choice.updated_at,signature:choice.signature},400);
console.log('PASS empty print job permits recheck; active member and whole order remain protected');
})().catch(e=>{console.error(e);process.exitCode=1});
