const {assert,sql,db,send,load,root}=require('./isolated-harness.cjs');
const {previewProductSync}=load(root+'/lib/product-center-sync.ts');
const {appendObsoletePrintRuleCleanup}=load(root+'/lib/print-rule-lifecycle.ts');
const {visiblePrintRules}=load(root+'/lib/named-print-rules.ts');
const id=n=>'AUTO-SHEET-'+String(n).padStart(20,'0');
const rule=n=>({code:id(n),name:'rule '+n,material:'PP',per_sheet:n===1?null:12,print_cost:1.5,lamination_cost:0,flat_cut_cost:0,die_cut_cost:0,enabled:'是'});
const bundle=(codes,n,revision)=>({version:3,variants:codes.map(sku=>({sku,name:sku,pack_qty:100,pack_unit:'个',supply_mode:'打印定制',cost_mode:'按实物自动计算',print_rule_code:id(n),product_id:sku,revision})),warehouse_config:{stocks:[],links:[],print_rules:[rule(n)],digit_conditions:[]}});
async function sync(b){const p=await previewProductSync(db,'isolated',{bundle:b});await send({action:'product_center_sync',bundle:b,expected_basis:p.basis});}
const exists=n=>!!sql.prepare("select 1 from print_rules where scope='isolated' and id=?").get('pc:'+id(n));
(async()=>{
 await sync(bundle(['A','B'],1,1));await sync(bundle(['A'],2,2));assert.ok(exists(1),'other SKU still references old rule');
 const stale=bundle(['B'],2,2),preview=await previewProductSync(db,'isolated',{bundle:stale});
 await sync(bundle(['B'],3,3));assert.ok(!exists(1),'final link and profile moved: obsolete rule deleted');
 await send({action:'product_center_sync',bundle:stale,expected_basis:preview.basis},400);assert.ok(exists(3),'stale concurrent sync cannot undo newer link');
 await sync(bundle(['A'],2,2));assert.ok(exists(2),'repeat sync preserves current rule');
 // Existing historical actual cost and serialized estimates retain their rule.
 sql.prepare("insert into print_jobs(scope,shop,order_id,note,cost_cents,basis,created_at,updated_at,estimate_snapshot) values('isolated','s','old','',150,'',1,1,?)").run(JSON.stringify({rule_id:'pc:'+id(2)}));
 await sync(bundle(['A'],4,4));assert.ok(exists(2));assert.equal(sql.prepare("select cost_cents from print_jobs where order_id='old'").get().cost_cents,150);
 await sync(bundle(['C'],5,1));sql.prepare("insert into print_rule_matches values('isolated','s','only','C',?,null,1)").run('pc:'+id(5));
 // Sync clears overrides on the synced SKU, so a separate order SKU retains it.
 sql.exec("update print_rule_matches set code='OTHER'");await sync(bundle(['C'],6,2));assert.ok(exists(5));
 await sync(bundle(['D'],7,1));sql.prepare("insert into warehouse_digit_conditions values('isolated','red',10,1,100,'人工核对','人工核对',?,1,1)").run('pc:'+id(7));await sync(bundle(['D'],8,2));assert.ok(exists(7));
 await sync(bundle(['E'],9,1));sql.prepare("insert into product_supply_profiles values('isolated','REFERENCE','source',1,?,1)").run(JSON.stringify({print_rules:[rule(9)]}));await sync(bundle(['E'],10,2));assert.ok(exists(9),'full retained source config protects reference');
 // Evaluate references at execution time, not when statements are prepared.
 await sync(bundle(['F'],11,1));sql.exec("delete from print_rule_links where code='F';delete from product_supply_profiles where code='F'");
 const ss=[];appendObsoletePrintRuleCleanup(db,'isolated',['pc:'+id(11)],'isolated','?=?',ss);
 sql.prepare("insert into print_rule_links values('isolated','NEW',?,null,1)").run('pc:'+id(11));await db.batch(ss);assert.ok(exists(11));
 const data={printRules:[{id:'pc:'+id(2),per_sheet:null},{id:'manual-draft',per_sheet:null},{id:'pc:'+id(7),per_sheet:null}],printRuleLinks:[],printRuleMatches:[],digitConditions:[{print_rule_id:'pc:'+id(7)}]};
 assert.deepEqual(visiblePrintRules(data).map(r=>r.id),['manual-draft','pc:'+id(7)]);
 const manual=[];appendObsoletePrintRuleCleanup(db,'isolated',['manual-draft'],'isolated','?=?',manual);assert.equal(manual.length,0,'manual drafts never collected');
 console.log('PASS split/repeat/stale sync, transaction-time references, order overrides, conditions, source snapshots, historical costs and manual draft visibility');
})().catch(e=>{console.error(e);process.exitCode=1;});
