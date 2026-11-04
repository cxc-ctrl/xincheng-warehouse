import {prepareAutoStocks,guardAutoStocks} from './product-sync-auto-stock';
import {appendAutoPrintAccounting} from './print-accounting';
import {appendObsoletePrintRuleCleanup} from './print-rule-lifecycle';
import {readRemarkRules,guardRemarkRules} from './digit-remark-actions';
import {AUTO_COST,FIXED_COST,priceNumber,stockPrice} from './cost-pricing';
import {PHYSICAL_UNITS,isPrintOnly,type Product,type PhysicalStock,type StockRule,type OrderLine} from './model';
import {printNumber} from './print-recipes';
import {saveChoice} from './digit-color-actions';
import {digitSignature,remarkColor,type DigitFulfillment,type DigitItem} from './digit-colors';
import {parseNumberRange} from './paper-plan';
import {printRange} from './print-size-rules';
type DB=D1Database;type Obj=Record<string,any>;
const txt=(v:unknown,max=160)=>{if(v==null)return '';if(typeof v!=='string'||v.length>max||/[\r\n]/.test(v)&&max<1000)throw new Error('同步文字字段无效');return v.trim();};
const modes=['现货','打印定制','现货优先（按条件）','定制订单'];
const inventoryModes=['','独立库存','共用库存','待关联','仅统计销售'];
const stockMode=(v:Obj)=>v.inventory_mode==='独立库存'?'direct':'recipe';
function syncImages(value:unknown){
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>30)throw new Error('每个SKU最多同步30张图片');
 return value.map((r:Obj)=>{if(!r||!/^([a-f0-9]{64})$/.test(r.id))throw new Error('同步图片无效');
 const check=(value:unknown,kind:string)=>{const u=new URL(txt(value,1000));if(u.origin!==(process.env.PRODUCT_CENTER_IMAGE_ORIGIN||'http://122.51.235.103:8004')||!new RegExp('^/warehouse-media/'+r.id+'/[A-Za-z0-9_-]{43}/'+kind+'$').test(u.pathname)||u.search||u.hash)throw new Error('同步图片地址无效');return u.href;};
 return {id:r.id,url:check(r.url,'image'),thumbnail_url:check(r.thumbnail_url,'thumb')};});
}
const hash=async(v:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(n=>n.toString(16).padStart(2,'0')).join('');
export function syncBundle(raw:Obj){
 if(![2,3].includes(raw?.version)||!Array.isArray(raw.variants)||!raw.variants.length||raw.variants.length>20)throw new Error('每批同步1至20个SKU');
 const seen=new Set<string>(),variants=raw.variants.map((v:Obj)=>{const sku=txt(v.sku),name=txt(v.name,300),mode=txt(v.supply_mode),q=printNumber(v.pack_qty,'每份数量',true);if(!sku||!name||seen.has(sku)||!modes.includes(mode)||!q||q>100000||!PHYSICAL_UNITS.includes(v.pack_unit))throw new Error('SKU、名称、数量、单位或供货方式不完整：'+sku);seen.add(sku);if(!Number.isSafeInteger(v.revision)||v.revision<1)throw new Error('商品版本无效');const inventory_mode=txt(v.inventory_mode);if(!inventoryModes.includes(inventory_mode))throw new Error('库存方式无效：'+sku);if(mode==='现货优先（按条件）'&&inventory_mode==='独立库存')throw new Error('条件现货须关联实物：'+sku);return {sku,name,product_name:txt(v.product_name,300),images:syncImages(v.images),supply_mode:mode,inventory_mode,stock_code:txt(v.stock_code),price:priceNumber(v.price,'参考销售价'),pack_qty:q,pack_unit:txt(v.pack_unit),cost:raw.version===3?(v.cost_mode===AUTO_COST?null:priceNumber(v.cost,'固定整份成本')):printNumber(v.cost,'整份货品成本'),cost_mode:raw.version===3?(v.cost_mode||AUTO_COST):undefined,erp_code:txt(v.erp_code),size:txt(v.size),material:txt(v.material),category:txt(v.category),note:txt(v.note,1000),print_rule_code:txt(v.print_rule_code),digit_condition_code:txt(v.digit_condition_code),product_id:txt(v.product_id),inventory_group:txt(v.inventory_group),revision:v.revision};});
 for(const v of variants)if(raw.version===3&&![AUTO_COST,FIXED_COST].includes(v.cost_mode))throw new Error('成本方式无效：'+v.sku);
 for(const v of variants)if(!isPrintOnly(v)&&v.inventory_mode==='独立库存'&&v.cost_mode===AUTO_COST)throw new Error('独立成品请选择固定整份成本，可暂不填价格：'+v.sku);
 const cfg:Obj={};for(const key of ['stocks','links','print_rules','digit_conditions']){if(!Array.isArray(raw.warehouse_config?.[key])||raw.warehouse_config[key].length>2000)throw new Error('同步规则列表无效');cfg[key]=raw.warehouse_config[key].map((r:Obj)=>({...r}));}
 if(raw.digit_rules_owner==='warehouse'&&(cfg.digit_conditions.length||variants.some(v=>v.supply_mode==='现货优先（按条件）'&&(v.digit_condition_code||v.print_rule_code||cfg.links.some((l:Obj)=>l.sku===v.sku)))))throw new Error('数字贴条件和版面关联请在仓库维护');
 if(raw.version===3)cfg.stocks=cfg.stocks.map((s:Obj)=>stockPrice(s));
 for(const key of ['stocks','print_rules','digit_conditions'])for(const r of cfg[key]){if(!txt(r.code))throw new Error('缺少规则编码');for(const field of ['name','material','color','size','unit','kind','print_rule_code','out_of_range','shortage'])if(typeof r[field]==='string')txt(r[field],field==='name'?300:160);}
 if(new Set(cfg.stocks.map((s:Obj)=>s.code)).size!==cfg.stocks.length||new Set(cfg.print_rules.map((s:Obj)=>s.code)).size!==cfg.print_rules.length)throw new Error('实物或打印规则重复');
 for(const s of cfg.stocks){if(!s.name||!PHYSICAL_UNITS.includes(s.unit)||!['普通实物','数字贴版面'].includes(s.kind))throw new Error('实物资料不完整');priceNumber(s.cost,'实物单位成本');if(!PHYSICAL_UNITS.includes(s.quote_unit||s.unit))throw new Error('计价单位无效');if(s.kind==='数字贴版面'&&(!s.color||!printNumber(s.digit_size,'数字尺寸')||!printNumber(s.start,'版面起号',true)||!printNumber(s.end,'版面止号',true)||s.end<s.start||!printNumber(s.each,'每号数量',true)))throw new Error('数字版面配置不完整');}
 for(const v of variants)if(v.inventory_mode==='独立库存'&&cfg.links.some((l:Obj)=>l.sku===v.sku))throw new Error('独立成品不能同时关联实物：'+v.sku);
 const pairs=new Set();for(const l of cfg.links){const pair=JSON.stringify([l.sku,l.stock_code]);if(pairs.has(pair)||!seen.has(l.sku)||!cfg.stocks.some((s:Obj)=>s.code===l.stock_code)||!['固定数量','按数字范围'].includes(l.mode)||l.mode==='固定数量'&&!printNumber(l.quantity,'每份实物消耗',true))throw new Error('库存关联无效或重复');pairs.add(pair);}
 for(const r of cfg.print_rules){if(!r.name||!r.material||!['是','否'].includes(r.enabled)||r.per_sheet===0)throw new Error('打印规则无效');printNumber(r.per_sheet,'可拼数量',true);for(const k of ['print_cost','lamination_cost','flat_cut_cost','die_cut_cost'])printNumber(r[k],'加工价格');}
 const conditions=new Set();for(const c of cfg.digit_conditions){const key=JSON.stringify([c.code,c.color,c.size]);if(conditions.has(key)||!c.color||!printNumber(c.size,'数字尺寸')||!printNumber(c.start,'现货起号',true)||!printNumber(c.end,'现货止号',true)||c.end<c.start||!['建议整单打印','人工核对'].includes(c.out_of_range)||!['建议整单打印','人工核对'].includes(c.shortage))throw new Error('数字贴条件无效或重复');conditions.add(key);}
 for(const v of variants){if(raw.digit_rules_owner!=='warehouse'&&v.supply_mode==='现货优先（按条件）'&&!cfg.digit_conditions.some((c:Obj)=>c.code===v.digit_condition_code))throw new Error('缺少数字贴条件：'+v.sku);for(const code of [v.print_rule_code,...cfg.digit_conditions.filter((c:Obj)=>c.code===v.digit_condition_code).map((c:Obj)=>c.print_rule_code)].filter(Boolean))if(!cfg.print_rules.some((r:Obj)=>r.code===code))throw new Error('缺少打印规则：'+code);}
 return {version:raw.version,digit_rules_owner:raw.digit_rules_owner==='warehouse'?'warehouse':'catalog',variants,warehouse_config:cfg};
}
async function syncContext(d:DB,scope:string,body:ReturnType<typeof syncBundle>){
 const codes=body.variants.map(v=>v.sku),stockCodes=body.warehouse_config.stocks.map((s:Obj)=>s.code),ruleIds=body.warehouse_config.print_rules.map((r:Obj)=>'pc:'+r.code);
 const rs=await d.batch([
  d.prepare('SELECT * FROM products WHERE scope=? AND code IN(SELECT value FROM json_each(?)) ORDER BY code').bind(scope,JSON.stringify(codes)),
  d.prepare('SELECT * FROM physical_stocks WHERE scope=? AND code IN(SELECT value FROM json_each(?)) ORDER BY code').bind(scope,JSON.stringify(stockCodes)),
  d.prepare('SELECT * FROM stock_rules WHERE scope=? AND sales_code IN(SELECT value FROM json_each(?)) ORDER BY sales_code,stock_code').bind(scope,JSON.stringify(codes)),
  d.prepare('SELECT * FROM print_rules WHERE scope=? AND id IN(SELECT value FROM json_each(?)) ORDER BY id').bind(scope,JSON.stringify(ruleIds)),
  d.prepare('SELECT * FROM product_supply_profiles WHERE scope=? AND code IN(SELECT value FROM json_each(?)) ORDER BY code').bind(scope,JSON.stringify(codes)),
  d.prepare('SELECT * FROM print_rule_links WHERE scope=? AND code IN(SELECT value FROM json_each(?)) ORDER BY code').bind(scope,JSON.stringify(codes)),
 ]);return rs.map(r=>r.results as Obj[]);
}
export async function previewProductSync(d:DB,scope:string,raw:Obj){const body=syncBundle(raw.bundle),auto=await prepareAutoStocks(d,scope,body),rows=await syncContext(d,scope,body);validateExisting(body,rows);return {auto_stocks:auto.autoStocks,auto_linked_skus:auto.autoLinks,association_issues:auto.issues,basis:await hash([rows,auto.checks]),new_skus:body.variants.filter(v=>!rows[0].some(p=>p.code===v.sku)).length,existing_skus:rows[0].length,stocks:body.warehouse_config.stocks.length,rules:body.warehouse_config.print_rules.length,cost_changes:body.warehouse_config.stocks.flatMap((s:Obj)=>{const old=rows[1].find(r=>r.code===s.code);return old?.cost!=null&&s.cost!=null&&old.cost!==s.cost?[{code:s.code,name:s.name,unit:s.unit,old:old.cost,next:s.cost}]:[];})};}
function validateExisting(body:ReturnType<typeof syncBundle>,rows:Obj[][]){
 for(const v of body.variants){
  const p=rows[0].find(p=>p.code===v.sku),profile=rows[4].find(p=>p.code===v.sku);
  if(profile&&(profile.source_product!==v.product_id||profile.source_revision>v.revision))throw new Error('SKU已归属其他商品或同步版本已更新：'+v.sku);
  if(p&&!['','待关联'].includes(v.inventory_mode)&&p.stock_mode!==stockMode(v))throw new Error('库存方式与仓库现有记录不同，实际数量保持不变；请核对独立成品/共用实物选择：'+v.sku);
  const desired=body.warehouse_config.links.filter((l:Obj)=>l.sku===v.sku).map((l:Obj)=>[l.stock_code,l.mode==='固定数量'?l.quantity:1]).sort(),old=rows[2].filter(l=>l.sales_code===v.sku).map(l=>[l.stock_code,l.per_unit]).sort();
  const preserve=isPrintOnly(v)||v.inventory_mode==='仅统计销售'||!desired.length&&v.inventory_mode!=='共用库存';
  if(p&&!preserve&&old.length&&JSON.stringify(desired)!==JSON.stringify(old))throw new Error('实物关联与仓库现有规则不同，请先核对；库存数量未修改：'+v.sku);
  if(v.inventory_mode==='共用库存'&&!isPrintOnly(v)&&!desired.length)throw new Error('共用实物尚未配置关联，请选择自动关联或先配置规则：'+v.sku);
  // Product-center sync owns current reference pricing; legacy actual costs stay frozen.
 }
 for(const s of body.warehouse_config.stocks){const old=rows[1].find(p=>p.code===s.code);if(old&&(old.archived||old.unit!==s.unit||(old.quantity!=null&&old.spec&&old.spec!==s.size)))throw new Error('已有实物单位、尺寸或归档状态冲突：'+s.code);}
}
export async function appendProductSync(b:Obj,d:DB,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='product_center_sync')return false;const body=syncBundle(b.bundle),auto=await prepareAutoStocks(d,scope,body),rows=await syncContext(d,scope,body);validateExisting(body,rows);if(await hash([rows,auto.checks])!==b.expected_basis)throw new Error('仓库资料或库存已变化，请重新预览同步');
 guardAutoStocks(d,ss,auto.checks,scope,rid,guard);
 for(const [table,list,idField] of [['products',rows[0],'code'],['physical_stocks',rows[1],'code'],['print_rules',rows[3],'id'],['product_supply_profiles',rows[4],'code'],['print_rule_links',rows[5],'code']] as const)for(const r of list)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND ${idField}=? AND updated_at=?) THEN json('同步资料已更新，请重新预览') ELSE 1 END`).bind(scope,rid,scope,r[idField],r.updated_at));
 for(const [table,ids,list,idField] of [['products',body.variants.map(v=>v.sku),rows[0],'code'],['physical_stocks',body.warehouse_config.stocks.map((s:Obj)=>s.code),rows[1],'code'],['print_rules',body.warehouse_config.print_rules.map((r:Obj)=>'pc:'+r.code),rows[3],'id'],['product_supply_profiles',body.variants.map(v=>v.sku),rows[4],'code'],['print_rule_links',body.variants.map(v=>v.sku),rows[5],'code']] as [string,string[],Obj[],string][])for(const id of ids)if(!list.some(r=>r[idField]===id))ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND ${idField}=?) THEN json('已有同编码资料，请重新预览') ELSE 1 END`).bind(scope,rid,scope,id));
 for(const v of body.variants){const old=rows[2].filter(r=>r.sales_code===v.sku);ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (SELECT count(*) FROM stock_rules WHERE scope=? AND sales_code=?)<>? THEN json('库存关联已变化，请重新预览') ELSE 1 END`).bind(scope,rid,scope,v.sku,old.length));for(const r of old)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM stock_rules WHERE scope=? AND sales_code=? AND stock_code=? AND per_unit=?) THEN json('库存关联已变化，请重新预览') ELSE 1 END`).bind(scope,rid,scope,v.sku,r.stock_code,r.per_unit));}
 for(const s of body.warehouse_config.stocks)ss.push(d.prepare(`INSERT INTO physical_stocks(scope,code,name,spec,unit,cost,quantity,count_at,location,minimum,note,updated_at) SELECT ?,?,?,?,?,?,NULL,NULL,'',10,?,? WHERE ${guard} ON CONFLICT(scope,code) DO UPDATE SET name=excluded.name,spec=excluded.spec,cost=COALESCE(excluded.cost,physical_stocks.cost),note=excluded.note,updated_at=excluded.updated_at`).bind(scope,s.code,s.name,s.size??'',s.unit,s.cost??null,s.note??'',now,scope,rid));
 for(const r of body.warehouse_config.print_rules)ss.push(d.prepare(`INSERT INTO print_rules(scope,id,name,material,per_sheet,print_cost,laminated,lamination_cost,cutting,flat_cut_cost,die_cut_cost,enabled,note,updated_at) SELECT ?,?,?,?,?,?,1,?,'both',?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO UPDATE SET name=excluded.name,material=excluded.material,per_sheet=excluded.per_sheet,print_cost=excluded.print_cost,laminated=1,lamination_cost=excluded.lamination_cost,cutting='both',flat_cut_cost=excluded.flat_cut_cost,die_cut_cost=excluded.die_cut_cost,enabled=excluded.enabled,note=excluded.note,updated_at=excluded.updated_at`).bind(scope,'pc:'+r.code,r.name,r.material,r.per_sheet??null,r.print_cost??null,r.lamination_cost??null,r.flat_cut_cost??null,r.die_cut_cost??null,r.enabled==='是'?1:0,r.note??'',now,scope,rid));
 for(const v of body.variants){
  const priorProduct=rows[0].find(p=>p.code===v.sku),mode=priorProduct&&['','待关联'].includes(v.inventory_mode)?priorProduct.stock_mode:stockMode(v);
  const previous=rows[4].find(p=>p.code===v.sku);
  if(v.images===undefined&&previous)v.images=JSON.parse(previous.config).variant.images;
  if(!v.product_name&&previous)v.product_name=JSON.parse(previous.config).variant.product_name||'';
  // Returning to stock requires a fresh warehouse count. Repeated stock syncs
  // must preserve the warehouse's manual tracking choice and actual balances.
  const resumeStock=!isPrintOnly(v)&&v.inventory_mode!=='仅统计销售'&&previous&&(isPrintOnly(JSON.parse(previous.config).variant)||JSON.parse(previous.config).variant.inventory_mode==='仅统计销售');
  const firstAssociation=rows[0].some(p=>p.code===v.sku)&&!rows[2].some(r=>r.sales_code===v.sku)&&body.warehouse_config.links.some((l:Obj)=>l.sku===v.sku);
  ss.push(d.prepare(`INSERT INTO products(scope,code,name,category,spec,pack,unit,cost,quantity,count_at,location,minimum,note,source,updated_at,stock_mode,recipe_at,tracking_enabled,erp_code,size,material) SELECT ?,?,?,?,?,?,'份',?,NULL,NULL,'',10,?,'产品中心同步',?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,code) DO UPDATE SET name=excluded.name,category=excluded.category,spec=excluded.spec,pack=excluded.pack,cost=${body.version===3?'excluded.cost':'COALESCE(excluded.cost,products.cost)'},packing_cost=${body.version===3?'0':'products.packing_cost'},note=excluded.note,erp_code=excluded.erp_code,size=excluded.size,material=excluded.material,tracking_enabled=CASE WHEN excluded.tracking_enabled=0 THEN 0 WHEN ? THEN 1 ELSE products.tracking_enabled END,tracking_at=CASE WHEN ? THEN excluded.updated_at ELSE products.tracking_at END,recipe_at=CASE WHEN ? THEN excluded.updated_at ELSE products.recipe_at END,updated_at=excluded.updated_at`).bind(scope,v.sku,v.name,v.category,v.size,v.pack_qty+v.pack_unit,v.cost,v.note,now,mode,mode==='recipe'?now:null,isPrintOnly(v)||v.inventory_mode==='仅统计销售'?0:1,v.erp_code,v.size,v.material,scope,rid,resumeStock?1:0,resumeStock?1:0,firstAssociation?1:0));
  for(const l of body.warehouse_config.links.filter((l:Obj)=>l.sku===v.sku))ss.push(d.prepare(`INSERT INTO stock_rules(scope,sales_code,stock_code,per_unit) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(scope,sales_code,stock_code) DO NOTHING`).bind(scope,v.sku,l.stock_code,l.mode==='固定数量'?l.quantity:1,scope,rid));
  ss.push(d.prepare(`INSERT INTO product_supply_profiles(scope,code,source_product,source_revision,config,updated_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,code) DO UPDATE SET source_product=excluded.source_product,source_revision=excluded.source_revision,config=excluded.config,updated_at=excluded.updated_at`).bind(scope,v.sku,v.product_id,v.revision,JSON.stringify({variant:v,digit_rules_owner:body.digit_rules_owner,...body.warehouse_config}),now,scope,rid));
  if(v.print_rule_code)ss.push(d.prepare(`DELETE FROM print_rule_matches WHERE scope=? AND code=? AND ${guard}`).bind(scope,v.sku,scope,rid));
  if(v.print_rule_code)ss.push(d.prepare(`INSERT INTO print_rule_links(scope,code,rule_id,updated_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(scope,code) DO UPDATE SET rule_id=excluded.rule_id,per_pack_override=NULL,updated_at=excluded.updated_at`).bind(scope,v.sku,'pc:'+v.print_rule_code,now,scope,rid));
 }
 const affected=(await d.prepare('SELECT DISTINCT shop,order_id FROM orders WHERE scope=? AND code IN(SELECT value FROM json_each(?))').bind(scope,JSON.stringify(body.variants.map(v=>v.sku))).all<{shop:string;order_id:string}>()).results;
 await appendAutoPrintAccounting(d,scope,affected,now,rid,ss,guard);
 // Only rules replaced by this batch are candidates; never sweep unrelated drafts.
 const incomingIds=new Set(body.warehouse_config.print_rules.map((r:Obj)=>'pc:'+r.code));
 const replaced=rows[5].filter(l=>body.variants.some(v=>v.sku===l.code&&v.print_rule_code&&'pc:'+v.print_rule_code!==l.rule_id)).map(l=>l.rule_id).filter(id=>!incomingIds.has(id));
 appendObsoletePrintRuleCleanup(d,scope,replaced,rid,guard,ss);
 return true;
}
export async function appendSupplyImport(d:DB,ss:D1PreparedStatement[],scope:string,o:OrderLine,old:OrderLine|undefined,now:number,rid:string,guard:string,ignoreCutoff:boolean){
 const profile=await d.prepare('SELECT * FROM product_supply_profiles WHERE scope=? AND code=?').bind(scope,o.code).first<Obj>();if(!profile)return {handled:false,cost:undefined};
 const productState=await d.prepare('SELECT tracking_at,cost,stock_mode FROM products WHERE scope=? AND code=?').bind(scope,o.code).first<{tracking_at:number|null;cost:number|null;stock_mode:string}>();
 const cfg=JSON.parse(profile.config),v=cfg.variant;
 if(['现货','现货优先（按条件）'].includes(v.supply_mode)&&cfg.digit_rules_owner==='warehouse'){
  const linked=await d.prepare('SELECT 1 FROM stock_rules r JOIN digit_stock_variants v ON v.scope=r.scope AND v.base_code=r.stock_code WHERE r.scope=? AND r.sales_code=? LIMIT 1').bind(scope,o.code).first();
  if(linked)return {handled:false,cost:undefined};
  if(v.supply_mode==='现货')return {handled:false,cost:undefined};
  const previous=await d.prepare('SELECT status FROM digit_fulfillments WHERE scope=? AND order_key=?').bind(scope,o.key).first<{status:string}>();
  if(previous)return {handled:true,cost:old?.unit_cost_snapshot??null};
  saveChoice(d,ss,scope,o,now,rid,guard,'pending','','未建对应库存：请在仓库关联数字贴版面并配置条件',[]);
  return {handled:true,cost:null};
 }
 if(!isPrintOnly(v)&&(productState?.stock_mode==='direct'||v.inventory_mode==='仅统计销售'))return {handled:false,cost:undefined};
 const prior=await d.prepare('SELECT * FROM digit_fulfillments WHERE scope=? AND order_key=?').bind(scope,o.key).first<DigitFulfillment>();
 if(prior?.status==='print'||prior?.status==='manual'||prior?.fixed_groups)return {handled:false,cost:undefined};
 const consumed=await d.prepare('SELECT 1 FROM order_stocks WHERE scope=? AND order_key=? AND deducted_qty>0').bind(scope,o.key).first();
 if(consumed){if(prior?.signature!==digitSignature(o))ss.push(d.prepare(`UPDATE digit_fulfillments SET status='pending',reason='已扣记录待复核：订单规格、数量或备注已变化；原扣减保留',updated_at=? WHERE scope=? AND order_key=? AND ${guard}`).bind(now,scope,o.key,scope,rid));return {handled:true,cost:old?.unit_cost_snapshot??null};}
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM product_supply_profiles WHERE scope=? AND code=? AND updated_at=?) THEN json('供货规则已更新') ELSE 1 END`).bind(scope,rid,scope,o.code,profile.updated_at));
 let reason='',color='',items:DigitItem[]=[],chosen:Obj|undefined;
 const stocks=(await d.prepare('SELECT * FROM physical_stocks WHERE scope=? AND code IN(SELECT stock_code FROM stock_rules WHERE scope=? AND sales_code=?)').bind(scope,scope,o.code).all<PhysicalStock>()).results;
 const links=v.supply_mode==='现货优先（按条件）'?cfg.links.filter((l:Obj)=>l.sku===o.code):(await d.prepare('SELECT stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code=?').bind(scope,o.code).all<{stock_code:string;per_unit:number}>()).results.map(l=>({sku:o.code,stock_code:l.stock_code,mode:'固定数量',quantity:l.per_unit})),range=parseNumberRange(o.spec)||parseNumberRange(o.title),parsed=printRange({...o,title:v.name||o.title});
 if(v.supply_mode==='定制订单')reason='建议整单打印：工单定制须核对姓名等定制内容，人工确认后打印';
 else if(v.supply_mode==='打印定制')reason='建议整单打印：商品配置为数码打印，须人工确认';
 else if(v.supply_mode==='现货优先（按条件）'){
  const conditions=cfg.digit_conditions.filter((c:Obj)=>c.code===v.digit_condition_code),decision=remarkColor(o,[...new Set<string>(conditions.map((c:Obj)=>c.color))],await readRemarkRules(d,scope));await guardRemarkRules(d,ss,scope,rid,guard);
  const sizeText=(o.spec+' '+v.size).match(/(?:直径)?(\d+(?:\.\d+)?)\s*(?:cm|厘米)/i),size=sizeText?Number(sizeText[1]):null;
  if(!decision.allocations.length)reason=decision.reason;
  else if(!range||!size||!parsed||parsed.issue||decision.allocations.length!==1||decision.allocations[0].quantity!==o.quantity)reason='规格 / 数量需核对：数字范围、尺寸或备注颜色无法唯一识别';
  else{color=decision.allocations[0].color;const matches=conditions.filter((c:Obj)=>c.color===color&&c.size===size);if(matches.length!==1)reason='规格 / 数量需核对：没有唯一数字贴条件';else{chosen=matches[0];if(range.start<chosen!.start||range.end>chosen!.end)reason=chosen!.out_of_range==='建议整单打印'?'建议整单打印：超出现货备货数字范围，须人工确认':'规格 / 数量需核对：超出现货备货范围';}}
 }
 if(!reason){
  const covered:number[]=[];
  for(const l of links){const s=cfg.stocks.find((s:Obj)=>s.code===l.stock_code);if(l.mode==='固定数量')items.push({sales_code:o.code,stock_code:l.stock_code,per_unit:l.quantity});else if(range&&s?.kind==='数字贴版面'&&(!color||s.color===color)&&(!chosen||s.digit_size===chosen.size)&&s.start<=range.end&&s.end>=range.start){for(let n=Math.max(s.start,range.start);n<=Math.min(s.end,range.end)&&covered.length<=100000;n++)covered.push(n);items.push({sales_code:o.code,stock_code:l.stock_code,per_unit:Math.ceil((parsed?.repeat??1)*o.quantity/s.each)/o.quantity});}}
  if(v.supply_mode==='现货优先（按条件）'&&range&&(covered.length!==range.end-range.start+1||new Set(covered).size!==covered.length))reason='未建对应库存：数字贴版面缺失或重复，请核对版面关联';
  if(!items.length)reason='未建对应库存：请先建立完整实物关联';
  if(!reason)for(const r of items){const s=stocks.find(s=>s.code===r.stock_code&&!s.archived);if(!s){reason='未建对应库存：实物已移除';break;}if(s.quantity==null||(s.count_at??0)<(productState?.tracking_at??0)){reason='待盘点：库存尚未确认';break;}if(s.quantity<r.per_unit*o.quantity){reason=chosen?.shortage==='建议整单打印'?'建议整单打印：已盘点库存不足，须人工确认':'库存不足，请人工核对';break;}}
 }
 const printCode=chosen?.print_rule_code||v.print_rule_code;if(reason.startsWith('建议整单打印')&&printCode)reason+='；打印规则 '+printCode;
 saveChoice(d,ss,scope,o,now,rid,guard,reason?'pending':'auto',color,reason||'按产品中心已配置的供货与实物规则发货',reason?[]:items);
 if(ignoreCutoff)ss.push(d.prepare(`UPDATE digit_fulfillments SET ignore_cutoff=1 WHERE scope=? AND order_key=? AND ${guard}`).bind(scope,o.key,scope,rid));
 if(chosen?.print_rule_code)ss.push(d.prepare(`INSERT INTO print_rule_matches(scope,shop,order_id,code,rule_id,updated_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,shop,order_id,code) DO NOTHING`).bind(scope,o.shop,o.order_id,o.code,'pc:'+chosen.print_rule_code,now,scope,rid));
 const productCost=v.supply_mode==='现货'&&v.cost_mode!==AUTO_COST?productState:null;
 const cost=reason?null:productCost?.cost!=null?productCost.cost:items.every(r=>stocks.find(s=>s.code===r.stock_code)?.cost!=null)?items.reduce((n,r)=>n+stocks.find(s=>s.code===r.stock_code)!.cost!*r.per_unit,0):null;
 return {handled:true,cost};
}

export {supplyProducts} from './product-supply-view';
export async function readProductCenterCosts(d:DB,scope:string,raw:Obj){
 if(!Array.isArray(raw.codes)||raw.codes.length>2000||raw.codes.some((c:unknown)=>!txt(c)))throw new Error('成本编码列表无效');
 const rows=(await d.prepare('SELECT code,name,unit,cost,updated_at FROM physical_stocks WHERE scope=? AND archived=0 AND code IN(SELECT value FROM json_each(?)) ORDER BY code').bind(scope,JSON.stringify([...new Set(raw.codes)])).all<Obj>()).results;
 return {rows,basis:await hash(rows)};
}
