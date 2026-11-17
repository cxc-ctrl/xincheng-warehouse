const {assert,load,root,route,product,imported,line}=require('./isolated-harness.cjs');
const {gzipSync}=require('node:zlib');
const {packWarehouse,unpackWarehouse}=load(root+'/lib/warehouse-transport.ts');
(async()=>{
 const raw={items:[{s:'data',optional:null,zero:0},{u:1,flag:false},{t:[],optional:'',missing:undefined}],nested:[null,0,false,'',undefined],note:'重复测试'.repeat(20)};
 assert.deepEqual(unpackWarehouse(packWarehouse(raw)),JSON.parse(JSON.stringify(raw)));
 await product('T','加载测试');await imported([line('O','T',2,'已发货',Date.now()-1000)]);
 for(const view of ['shops','import','analysis','all']){
  const get=async compact=>{const r=await route.GET(new Request('http://isolated.test/api/warehouse?view='+view+(compact?'&transport=compact':'')));assert.equal(r.status,200);return r.json();};
  assert.deepEqual(unpackWarehouse(await get(true)),await get(false),'Transport preserves all fields for '+view);
 }
 const orders=Array.from({length:10000},(_,i)=>({key:'["SHOP","ORDER-'+i+'","SKU-EXAMPLE-CODE-123456789"]',title:'数字贴纸'.repeat(20),quantity:i%5,cost:null,notes:'用户确认的实际商品及相关规格'.repeat(5)}));
 const value={orders,rules:orders.map(o=>({order_key:o.key,status:'auto'}))};const packed=packWarehouse(value);assert.deepEqual(unpackWarehouse(packed),value);
 const sizes={json:Buffer.byteLength(JSON.stringify(value)),compact:Buffer.byteLength(JSON.stringify(packed)),gzip:gzipSync(JSON.stringify(value)).length,compactGzip:gzipSync(JSON.stringify(packed)).length};
 assert(sizes.compact<sizes.json);console.log('PASS complete roundtrip, null/zero/optional fields, all APIs unchanged and large-order transport',sizes);
})().catch(e=>{console.error(e);process.exitCode=1});
