const {assert,sql,send,data}=require('./isolated-harness.cjs');
(async()=>{
 const shop={platform:'ALI',code:'DUP',name:'重复配置',team:'团队',kind:'supply',enabled:1,effective_day:'2026-10-01',rate:'20',goods:true,packing:false,freight:false};
 await send({action:'shop_save',shop});
 let s=(await data()).shopConfigs.find(x=>x.code==='DUP');
 await send({action:'shop_delete',id:s.id,updated_at:s.updated_at-1},400);
 sql.prepare("insert into order_source_shops(scope,source,source_shop,platform,shop) values('isolated','xiaohongshu','source','ALI','DUP')").run();
 await send({action:'shop_delete',id:s.id,updated_at:s.updated_at},400);
 assert.equal(sql.prepare('select count(*) n from shop_pricing_versions where shop_id=?').get(s.id).n,1);
 sql.prepare('delete from order_source_shops').run();
 await send({action:'shop_delete',id:s.id,updated_at:s.updated_at});
 assert.equal((await data()).shopConfigs.some(x=>x.id===s.id),false);
 assert.equal(sql.prepare('select count(*) n from shop_pricing_versions where shop_id=?').get(s.id).n,0);
 console.log('PASS unused shop deletion, stale update and referenced shop guards');
})().catch(e=>{console.error(e);process.exitCode=1});

