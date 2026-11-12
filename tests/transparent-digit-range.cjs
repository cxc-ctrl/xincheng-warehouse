const {assert,sql,send,product,imported,data,line,qty}=require('./isolated-harness.cjs');
(async()=>{
 await send({action:'warehouse_digit_condition',condition:{color:'透明',size:10,start:1,end:100,out_of_range:'建议整单打印',shortage:'人工核对',print_rule_id:'',enabled:1,updated_at:0}});
 for(const [code,end] of [['IN',100],['OUT',150]]){
 const name='透明10cm数字贴（1～'+end+'）';await product(code,name);
 sql.prepare('insert into product_supply_profiles values(?,?,?,?,?,?)').run('isolated',code,'source',1,JSON.stringify({variant:{name,supply_mode:'现货',inventory_mode:'共用库存'},digit_rules_owner:'warehouse',stocks:[],links:[],print_rules:[],digit_conditions:[]}),Date.now());
 await send({action:'physical_product',new_product:true,product:{code:code+'-BOARD',name:'透明10cm数字贴（1～6）',unit:'张',cost:.5}});
 await send({action:'stock_rule',sales_codes:[code],items:[{stock_code:code+'-BOARD',per_unit:1}],at:Date.now()-5000});
 sql.prepare('update physical_stocks set quantity=2000,count_at=? where code=?').run(Date.now()-4000,code+'-BOARD');
 await imported([{...line(code,code,1),spec:'1～'+end,shipped_at:Date.now()+1000}]);
 }
 assert.equal(qty('IN-BOARD'),1999);
 assert.equal(qty('OUT-BOARD'),2000);
 let d=await data(),f=d.digitFulfillments.find(f=>f.order_key.includes('OUT'));
 assert(f.reason.startsWith('建议整单打印'));
 assert.equal(d.products.find(p=>p.code==='OUT').supply_mode,'打印定制');
 assert.equal(d.products.find(p=>p.code==='IN').supply_mode,'现货');
 console.log('PASS transparent limits: inside deducts, outside held for printing, quantity untouched outside');
})().catch(e=>{console.error(e);process.exitCode=1});
