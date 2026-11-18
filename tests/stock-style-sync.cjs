const {assert,sql,db,load,root}=require('./isolated-harness.cjs');
const {prepareAutoStocks}=load(root+'/lib/product-sync-auto-stock.ts');
const {duplicateStockPreview}=load(root+'/lib/duplicate-stock-preview.ts');
const {stockIdentity,stockSize}=load(root+'/lib/stock-identity.ts');
const v=(sku,n,size='9x5.4cm',style='横款',extra={})=>({sku,product_id:'product-1',inventory_group:'',name:`无印风【${style}】${size}-${n}贴`,size,material:'铜版纸不干胶',category:'贴纸',pack_qty:n,pack_unit:'贴',supply_mode:'现货',inventory_mode:'待关联',cost:n*.0144,...extra});
const bundle=variants=>({variants,warehouse_config:{stocks:[],links:[]}});
const profile=x=>sql.prepare('INSERT INTO product_supply_profiles(scope,code,source_product,source_revision,config,updated_at) VALUES(?,?,?,?,?,?)').run('isolated',x.sku,x.product_id,1,JSON.stringify({variant:x}),1);
(async()=>{
 const small=v('ALXH-HK-100',100,'5.4x9cm'),large=v('SHTZ-HK-500',500),thousand=v('SHTZ-HK-1000',1000);
 assert.equal(stockSize('9＊5.40 厘米'),stockSize('5.4×9cm'));
 assert.equal(stockIdentity(small),stockIdentity(large));
 for(const other of [v('V-500',500,'5.4x9cm','竖款'),v('B-500',500,'9x5.4cm','横款',{material:'透明'}),v('C-500',500,'9x5.4cm','横款',{product_id:'another'}),v('D-500',500,'9x5.4cm','横款',{pack_unit:'张'}),v('E-500',500,'9x6cm')])assert.notEqual(stockIdentity(small),stockIdentity(other));
 const b=bundle([small,large,thousand]),first=await prepareAutoStocks(db,'isolated',b);
 assert.equal(first.autoStocks.length,1);assert.deepEqual(b.warehouse_config.links.map(x=>x.quantity),[100,500,1000]);assert.equal(new Set(b.warehouse_config.links.map(x=>x.stock_code)).size,1);
 // Simulate an existing counted warehouse recipe from a prior partial sync.
 profile(small);sql.prepare('INSERT INTO physical_stocks(scope,code,name,spec,unit,cost,quantity,count_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('isolated','OLD','无印风【横款】','5.4x9cm','贴',.0144,7200,1,1);
 sql.prepare('INSERT INTO stock_rules(scope,sales_code,stock_code,per_unit) VALUES(?,?,?,?)').run('isolated',small.sku,'OLD',100);
 const incoming=bundle([large,thousand]);await prepareAutoStocks(db,'isolated',incoming);assert.deepEqual(incoming.warehouse_config.links.map(x=>x.stock_code),['OLD','OLD']);assert.equal(incoming.warehouse_config.stocks.length,0);
 assert.equal(sql.prepare('SELECT quantity FROM physical_stocks WHERE code=?').get('OLD').quantity,7200);
 // Explicit frontend links remain authoritative.
 const explicit=bundle([large]);explicit.warehouse_config.links.push({sku:large.sku,stock_code:'MANUAL',mode:'固定数量',quantity:500});await prepareAutoStocks(db,'isolated',explicit);assert.equal(explicit.warehouse_config.links[0].stock_code,'MANUAL');
 profile(large);sql.prepare('INSERT INTO physical_stocks(scope,code,name,spec,unit,cost,quantity,count_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('isolated','SECOND','无印风【横款】','9x5.4cm','贴',.0144,-5000,1,1);
 sql.prepare('INSERT INTO stock_rules(scope,sales_code,stock_code,per_unit) VALUES(?,?,?,?)').run('isolated',large.sku,'SECOND',500);
 const conflict=bundle([thousand]),res=await prepareAutoStocks(db,'isolated',conflict);assert.equal(res.autoLinks.length,0);assert.match(res.issues[0].reason,/特殊关联/);
 const ps=[small,large].map(x=>({code:x.sku,name:x.name,pack:x.pack_qty+'贴',size:x.size,material:x.material,category:x.category,source_product:x.product_id,supply_mode:'现货',tracking_enabled:1}));
 const stocks=sql.prepare('SELECT * FROM physical_stocks').all(),rules=sql.prepare('SELECT * FROM stock_rules').all();
 const preview=duplicateStockPreview(ps,stocks,rules);assert.equal(preview.length,1);assert.deepEqual(preview[0].stocks.map(x=>x.stock.quantity),[7200,-5000]);assert.equal(preview[0].stocks.flatMap(x=>x.products).length,2);
 assert.equal(duplicateStockPreview(ps.map((p,i)=>i?{...p,name:p.name.replace('横款','竖款')}:p),stocks,rules).length,0);
 const printed=bundle([v('PRINT',20,'9x5.4cm','横款',{supply_mode:'打印定制'})]);await prepareAutoStocks(db,'isolated',printed);assert.equal(printed.warehouse_config.links.length,0);
 console.log('PASS stock style identity, cross-prefix packages, existing balances, explicit rules, duplicate preview and printing exclusions');
})().catch(e=>{console.error(e);process.exitCode=1;});
