const {assert,sql,send,db,load,root}=require('./isolated-harness.cjs');
const profile=(code,cost,extra={})=>({sku:code,product_id:'pc',revision:5,name:code,category:'贴纸',supply_mode:'现货',inventory_mode:'待关联',cost_mode:'固定整份成本',cost,...extra});
function sku(v,links=[],stock_mode='recipe'){
 sql.prepare('INSERT INTO products(scope,code,name,category,cost,stock_mode,updated_at) VALUES(?,?,?,?,?,?,?)').run('isolated',v.sku,v.name,'贴纸',v.cost,stock_mode,1);
 sql.prepare('INSERT INTO product_supply_profiles(scope,code,source_product,source_revision,config,updated_at) VALUES(?,?,?,?,?,?)').run('isolated',v.sku,v.product_id,v.revision,JSON.stringify({variant:v}),1);
 for(const [stock,q] of links)sql.prepare('INSERT INTO stock_rules(scope,sales_code,stock_code,per_unit) VALUES(?,?,?,?)').run('isolated',v.sku,stock,q);
}
function stock(code,cost=.0588,unit='贴'){
 sql.prepare('INSERT INTO physical_stocks(scope,code,name,unit,cost,quantity,count_at,location,minimum,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('isolated',code,code,unit,cost,104175,1000,'A1',300,1);
}
const request=(variants,id)=>send({action:'product_center_sync_costs',...(id?{request_id:id}:{}),variants:variants.map(v=>({sku:v.sku,product_id:v.product_id,revision:v.revision}))});
const get=c=>sql.prepare("SELECT * FROM physical_stocks WHERE scope='isolated' AND code=?").get(c);
(async()=>{
 stock('COFFEE'); const packs=[25,125,200].map((q,i)=>profile('COFFEE-'+[100,500,1000][i],q*.04));
 packs.forEach((v,i)=>sku(v,[['COFFEE',[25,125,200][i]]]));
 const before=get('COFFEE'),rules=sql.prepare('SELECT * FROM stock_rules').all();
 let result=(await request(packs,'retry-cost')).physicalCosts;assert.equal(result.changes[0].next,.04);
 const after=get('COFFEE');for(const k of Object.keys(before))if(!['cost','updated_at'].includes(k))assert.equal(after[k],before[k],k);
 assert.deepEqual(sql.prepare('SELECT * FROM stock_rules').all(),rules);
 assert.equal((await request(packs,'retry-cost')).physicalCosts.repeated,true);
 assert.equal((await request(packs)).physicalCosts.unchanged.length,1);
 // The other SKUs sharing stock must participate even outside this request.
 sql.prepare("UPDATE products SET cost=10 WHERE code='COFFEE-500'").run();
 sql.prepare("UPDATE product_supply_profiles SET config=? WHERE code='COFFEE-500'").run(JSON.stringify({variant:{...packs[1],cost:10}}));
 result=(await request([packs[0]])).physicalCosts;assert.equal(result.changes.length,0);assert.match(result.skipped[0].reason,/不一致/);assert.equal(get('COFFEE').cost,.04);
 // Deduction quantity is authoritative; names/pack quantities are not conversion factors.
 stock('SHEETS',1,'张');const sheets=profile('100-stickers',10,{pack_qty:100,pack_unit:'贴'});sku(sheets,[['SHEETS',2]]);assert.equal((await request([sheets])).physicalCosts.changes[0].next,5);
 stock('ZERO',1);const zero=profile('ZERO-SKU',0);sku(zero,[['ZERO',50]]);await request([zero]);assert.equal(get('ZERO').cost,0);
 stock('MULTI');stock('COMPONENT');const multi=profile('BUNDLE',10);sku(multi,[['MULTI',10],['COMPONENT',20]]);result=(await request([multi])).physicalCosts;assert.equal(result.changes.length,0);assert.ok(result.skipped.every(x=>x.warning));
 stock('DIGIT');const digit=profile('DIGIT-SKU',8);sku(digit,[['DIGIT',10]]);
 sql.prepare('INSERT INTO digit_stock_variants(scope,base_code,color,stock_code,size,start,end,available_end) VALUES(?,?,?,?,?,?,?,?)').run('isolated','DIGIT','白','DIGIT-W',10,1,100,100);
 result=(await request([digit])).physicalCosts;assert.equal(result.changes.length,0);assert.match(result.skipped[0].reason,/数字贴/);assert.equal(get('DIGIT').cost,.0588);
 const direct=profile('DIRECT',3,{inventory_mode:'独立库存'});sku(direct,[],'direct');result=(await request([direct])).physicalCosts;assert.match(result.skipped[0].reason,/独立库存/);assert.equal(result.skipped[0].warning,false);
 stock('PRINT-STOCK');const printed=profile('PRINTED',3,{supply_mode:'打印定制'});sku(printed,[['PRINT-STOCK',10]]);assert.equal((await request([printed])).physicalCosts.changes.length,0);
 stock('AUTO');const auto=profile('AUTOPRICE',null,{cost_mode:'按实物自动计算'});sku(auto,[['AUTO',10]]);assert.equal((await request([auto])).physicalCosts.changes.length,0);
 const response=await send({action:'product_center_sync_costs',variants:[{sku:packs[0].sku,product_id:'pc',revision:4}]},400);assert.match(response.error,/版本/);
 // A competing association update between read and commit aborts the cost write.
 const {syncPhysicalCosts}=load(root+'/lib/product-sync-costs.ts');
 const racing={prepare:db.prepare,batch:async statements=>{sql.prepare("UPDATE stock_rules SET per_unit=4 WHERE sales_code='100-stickers'").run();return db.batch(statements);}};
 await assert.rejects(()=>syncPhysicalCosts(racing,'isolated',{request_id:'race',variants:[{sku:sheets.sku,product_id:'pc',revision:5}]},100));
 assert.equal(get('SHEETS').cost,5);assert.equal(sql.prepare("SELECT count(*) n FROM receipts WHERE id='race'").get().n,0);
 const missing=profile('MISSING',1);sku(missing,[['DOES-NOT-EXIST',10]]);assert.equal((await request([missing])).physicalCosts.skipped[0].warning,true);
 // Normal metadata sync defers a stale explicit physical price until reconciliation.
 const explicit={...sheets,pack_qty:100,pack_unit:'贴',revision:6,size:'',material:'铜版纸不干胶',inventory_mode:'共用库存',stock_code:'SHEETS',cost:12};
 const bundle={version:3,digit_rules_owner:'warehouse',variants:[explicit],warehouse_config:{stocks:[{code:'SHEETS',name:'纸张',size:'',unit:'张',kind:'普通实物',cost:99}],links:[{sku:explicit.sku,stock_code:'SHEETS',mode:'固定数量',quantity:4}],print_rules:[],digit_conditions:[]}};
 const preview=(await send({action:'product_center_sync_preview',bundle})).syncPreview;
 await send({action:'product_center_sync',bundle,expected_basis:preview.basis});assert.equal(get('SHEETS').cost,5);
 assert.equal((await request([explicit])).physicalCosts.changes[0].next,3);
 // Scope isolation and no writes to historical order costs or movements.
 assert.equal(sql.prepare('SELECT count(*) n FROM movements').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM orders').get().n,0);
 console.log('PASS actual deduction conversion, all shared siblings, conflict/zero/retry, preserved inventory, component/digit/print/auto/direct boundaries, stale version');
})().catch(e=>{console.error(e);process.exitCode=1;});
