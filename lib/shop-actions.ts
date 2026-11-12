import {chinaTime,isValid,type OrderLine} from './model';
import {appendOrderImport} from './order-actions';
import {ignoredOrderCode,readImportIgnoreRules} from './order-scope';
import {appendAutoPrintAccounting} from './print-accounting';
import {readOrderRefresh} from './order-refresh';
import type {ShopData,Shop,ShopVersion,ShopAssignment,ShopPending,ShopPolicy} from './shops';
const text=(v:unknown,label:string,required=true)=>{if(typeof v!=='string'||v.length>160||/[\r\n]/.test(v)||(required&&!v.trim()))throw new Error('请填写有效的'+label);return v.trim();};
export async function readShopData(d:D1Database,scope:string,page=0):Promise<ShopData>{
 page=Number.isSafeInteger(page)&&page>=0?page:0;
 const r=await d.batch([
  d.prepare('SELECT id,platform,code,name,team,kind,enabled,updated_at FROM shop_configs WHERE scope=? ORDER BY team,name,code').bind(scope),
  d.prepare('SELECT id,shop_id,effective_at,config,created_at FROM shop_pricing_versions WHERE scope=? ORDER BY effective_at,created_at').bind(scope),
  d.prepare('SELECT platform,shop,order_id,version_id,basis_at FROM shop_order_pricing WHERE scope=?').bind(scope),
  d.prepare(`SELECT o.platform,o.shop,COUNT(DISTINCT o.order_id) AS orders,COUNT(*) AS lines,MIN(o.order_time) AS first_at,CASE WHEN s.id IS NULL THEN '店铺尚未配置' WHEN s.enabled=0 THEN '店铺已停用' ELSE '缺覆盖发货日期的结算规则' END AS reason FROM orders o LEFT JOIN shop_configs s ON s.scope=o.scope AND s.platform=o.platform AND s.code=o.shop LEFT JOIN shop_order_pricing a ON a.scope=o.scope AND a.platform=o.platform AND a.shop=o.shop AND a.order_id=o.order_id WHERE o.scope=? AND (s.id IS NULL OR s.enabled=0 OR (a.version_id IS NULL AND (o.status IN('已发货','已完成') OR o.shipped_qty>0))) GROUP BY o.platform,o.shop,reason ORDER BY orders DESC`).bind(scope),
  d.prepare("SELECT id,payload,filename,updated_at FROM shop_held_orders WHERE scope=? AND status='pending' ORDER BY updated_at,id LIMIT 40 OFFSET ?").bind(scope,page*40),
  d.prepare("SELECT COUNT(*) AS n FROM shop_held_orders WHERE scope=? AND status='pending'").bind(scope),
  d.prepare('SELECT supplier_team FROM shop_settings WHERE scope=?').bind(scope),
  d.prepare('SELECT source,source_shop,platform,shop FROM order_source_shops WHERE scope=?').bind(scope)
 ]);
 return {sourceShopMappings:r[7].results as import("./order-sources").SourceShopMapping[],shopConfigs:r[0].results as Shop[],shopVersions:(r[1].results as any[]).map(v=>({...v,config:JSON.parse(v.config)})) as ShopVersion[],shopAssignments:r[2].results as ShopAssignment[],shopPending:r[3].results as ShopPending[],shopHeld:(r[4].results as any[]).map(v=>{const {payload,...rest}=v;return {...rest,line:JSON.parse(payload)};}),shopHeldTotal:Number((r[5].results[0] as any)?.n??0),shopHeldPage:page,supplierTeam:String((r[6].results[0] as any)?.supplier_team??'现货团队')};
}
// Append after import/config statements. Existing order policies are immutable.
export function appendShopSnapshots(d:D1Database,scope:string,ss:D1PreparedStatement[],now:number,rid:string,guard:string,keys?:string[]){
 const filter=keys?' AND key IN(SELECT value FROM json_each(?))':'';
 ss.push(d.prepare(`WITH shipped AS (SELECT platform,shop,order_id,MIN(COALESCE(shipped_at,source_updated_at,?)) AS basis_at FROM orders WHERE scope=? AND shop<>'' AND (status IN('已发货','已完成') OR shipped_qty>0) ${filter} GROUP BY platform,shop,order_id) INSERT INTO shop_order_pricing(scope,platform,shop,order_id,version_id,basis_at,created_at) SELECT s.scope,g.platform,g.shop,g.order_id,v.id,g.basis_at,? FROM shipped g JOIN shop_configs s ON s.scope=? AND s.platform=g.platform AND s.code=g.shop AND s.enabled=1 JOIN shop_pricing_versions v ON v.scope=s.scope AND v.shop_id=s.id AND v.id=(SELECT latest.id FROM shop_pricing_versions latest WHERE latest.scope=s.scope AND latest.shop_id=s.id AND latest.effective_at<=g.basis_at ORDER BY latest.effective_at DESC,latest.created_at DESC LIMIT 1) WHERE ${guard} ON CONFLICT(scope,platform,shop,order_id) DO NOTHING`).bind(now,scope,...(keys?[JSON.stringify(keys)]:[]),now,scope,scope,rid));
}
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
export async function shopActionResponse(b:Record<string,any>,d:D1Database,scope:string){
 const shopData=await readShopData(d,scope);
 if(b.action!=='shop_release')return {shopData};
 if(!Array.isArray(b.ids)||b.ids.length>40)throw new Error('暂存订单更新范围无效');
 const released=(await d.prepare("SELECT h.payload,s.code FROM shop_held_orders h JOIN shop_configs s ON s.scope=h.scope AND s.id=h.shop_id WHERE h.scope=? AND h.id IN(SELECT value FROM json_each(?)) AND h.status='released'").bind(scope,JSON.stringify(b.ids)).all<{payload:string;code:string}>()).results;
 const groups=new Map(released.map(h=>{const row=JSON.parse(h.payload);return [JSON.stringify([h.code,row.order_id]),{shop:h.code,order_id:row.order_id}];}));
 const shopOrderRefresh=[];for(const group of groups.values())shopOrderRefresh.push(await readOrderRefresh(d,scope,group));
 return {shopData,shopOrderRefresh};
}
export async function appendShopAction(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string,v:any){
 if(b.action==='shop_delete'){
  const id=text(b.id,'店铺ID'),old=await d.prepare('SELECT * FROM shop_configs WHERE scope=? AND id=?').bind(scope,id).first<Shop>();
  if(!old||old.updated_at!==b.updated_at)throw new Error('店铺配置已变化，请刷新后重试');
  const referenced=`EXISTS(SELECT 1 FROM orders WHERE scope=? AND platform=? AND shop=?) OR EXISTS(SELECT 1 FROM shop_order_pricing a JOIN shop_pricing_versions v ON v.scope=a.scope AND v.id=a.version_id WHERE v.scope=? AND v.shop_id=?) OR EXISTS(SELECT 1 FROM shop_held_orders WHERE scope=? AND shop_id=?) OR EXISTS(SELECT 1 FROM order_source_shops WHERE scope=? AND platform=? AND shop=?) OR EXISTS(SELECT 1 FROM ignored_order_lines WHERE scope=? AND shop=?)`;
  const args=[scope,old.platform,old.code,scope,id,scope,id,scope,old.platform,old.code,scope,old.code];
  if((await d.prepare(`SELECT (${referenced}) AS used`).bind(...args).first<{used:number}>())?.used)throw new Error('该店铺已有订单、结算或导入关联，请改为停用，历史记录需要保留');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (NOT EXISTS(SELECT 1 FROM shop_configs WHERE scope=? AND id=? AND updated_at=?) OR ${referenced}) THEN json('店铺已变化或已有业务记录，无法删除') ELSE 1 END`).bind(scope,rid,scope,id,old.updated_at,...args));
  ss.push(d.prepare(`DELETE FROM shop_pricing_versions WHERE scope=? AND shop_id=? AND ${guard}`).bind(scope,id,scope,rid));
  ss.push(d.prepare(`DELETE FROM shop_configs WHERE scope=? AND id=? AND ${guard}`).bind(scope,id,scope,rid));
  return true;
 }
 if(b.action==='shop_settings'){
  const team=text(b.supplier_team,'供货团队名称');ss.push(d.prepare(`INSERT INTO shop_settings SELECT ?,?,? WHERE ${guard} ON CONFLICT(scope) DO UPDATE SET supplier_team=excluded.supplier_team,updated_at=excluded.updated_at`).bind(scope,team,now,scope,rid));return true;
 }
 if(b.action==='shop_save'){
  const raw=b.shop??{},platform=text(raw.platform??'','平台',false),code=text(raw.code,'ERP店铺编码'),name=text(raw.name,'店铺名称'),team=text(raw.team,'所属团队'),kind=raw.kind;
  if(!['own','supply'].includes(kind)||![0,1].includes(raw.enabled)||typeof raw.effective_day!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(raw.effective_day))throw new Error('请选择核算类型、生效日期和启用状态');
  const at=chinaTime(raw.effective_day+' 00:00'),rate=Number(raw.rate);if(new Date(at+8*3600000).toISOString().slice(0,10)!==raw.effective_day)throw new Error('规则生效日期无效');
  if(raw.rate===''||!Number.isFinite(rate)||rate<0||rate>100||Math.abs(rate*100-Math.round(rate*100))>1e-7)throw new Error('加价比例须为0～100，最多两位小数');
  if(!['goods','packing','freight'].every(k=>typeof raw[k]==='boolean'))throw new Error('请选择参与加价的成本');
  const old=raw.id?await d.prepare('SELECT * FROM shop_configs WHERE scope=? AND id=?').bind(scope,text(raw.id,'店铺ID')).first<Shop>():null;
  if(raw.id&&!old)throw new Error('店铺不存在');if(old&&(old.updated_at!==raw.updated_at||old.platform!==platform||old.code!==code))throw new Error('店铺已更新或编码被修改，请重新打开；新编码请新建店铺');
  const id=old?.id??crypto.randomUUID(),version=crypto.randomUUID(),stamp=Math.max(now,(old?.updated_at??0)+1),supplier=(await d.prepare('SELECT supplier_team FROM shop_settings WHERE scope=?').bind(scope).first<{supplier_team:string}>())?.supplier_team??'现货团队';
  const policy:ShopPolicy={name,team,supplier_team:supplier,kind,rate_bps:kind==='own'?0:Math.round(rate*100),goods:raw.goods,packing:raw.packing,freight:raw.freight};
  if(old)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM shop_configs WHERE scope=? AND id=? AND updated_at=?) THEN json('店铺配置已变化') ELSE 1 END`).bind(scope,rid,scope,id,old.updated_at));
  else ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM shop_configs WHERE scope=? AND platform=? AND code=?) THEN json('店铺编码已经存在，请编辑已有店铺') ELSE 1 END`).bind(scope,rid,scope,platform,code));
  ss.push(d.prepare(`INSERT INTO shop_configs SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO UPDATE SET name=excluded.name,team=excluded.team,kind=excluded.kind,enabled=excluded.enabled,updated_at=excluded.updated_at`).bind(scope,id,platform,code,name,team,kind,raw.enabled,stamp,scope,rid));
  ss.push(d.prepare(`INSERT INTO shop_pricing_versions SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(scope,version,id,at,JSON.stringify(policy),stamp,scope,rid));appendShopSnapshots(d,scope,ss,now,rid,guard);return true;
 }
 if(b.action==='shop_hold_import'){
  if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>40)throw new Error('每次暂存1～40条订单');const filename=v.str(b.filename,300);
  const ignoreRules=await readImportIgnoreRules(d,scope);
  for(const line of b.lines){if(ignoredOrderCode(line.code,ignoreRules))continue;if(typeof line.shop!=='string'||line.shop.trim()||!line.order_id||typeof line.platform!=='string'||typeof line.code!=='string'||!Number.isSafeInteger(line.quantity)||line.quantity<=0)throw new Error('仅暂存店铺为空的有效订单行');
   const payload=JSON.stringify(line);if(payload.length>30000)throw new Error('暂存订单文字过长');const id=await hash(JSON.stringify([scope,line.platform,line.order_id,line.code||line.title+':'+line.spec]));
   ss.push(d.prepare(`INSERT INTO shop_held_orders SELECT ?,?,?,?,'pending','',? WHERE ${guard} ON CONFLICT(scope,id) DO UPDATE SET payload=excluded.payload,filename=excluded.filename,status='pending',updated_at=excluded.updated_at WHERE shop_held_orders.status='pending' OR shop_held_orders.payload<>excluded.payload`).bind(scope,id,payload,filename,now,scope,rid));
  }return true;
 }
 if(b.action==='shop_release'){
  if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>40||new Set(b.ids).size!==b.ids.length)throw new Error('请选择1～40条暂存订单');
  const shop=await d.prepare('SELECT * FROM shop_configs WHERE scope=? AND id=? AND enabled=1').bind(scope,text(b.shop_id,'目标店铺')).first<Shop>();if(!shop)throw new Error('请选择启用的目标店铺');
  const batch='shop-release-'+rid,lines:OrderLine[]=[];
  for(const id of b.ids){const held=await d.prepare("SELECT payload FROM shop_held_orders WHERE scope=? AND id=? AND status='pending'").bind(scope,text(id,'暂存编号')).first<{payload:string}>();if(!held)throw new Error('暂存记录已处理，请刷新');const raw=JSON.parse(held.payload) as OrderLine;
   if(raw.platform&&raw.platform!==shop.platform)throw new Error('订单平台与目标店铺不一致');const line={...raw,shop:shop.code,platform:shop.platform,key:JSON.stringify([shop.code,raw.order_id,raw.code||'未填编码:'+raw.title+':'+raw.spec])};lines.push(line);
   ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM shop_held_orders WHERE scope=? AND id=? AND status='pending' AND payload=?) THEN json('暂存订单已经变化') ELSE 1 END`).bind(scope,rid,scope,id,held.payload));
   ss.push(d.prepare(`UPDATE shop_held_orders SET status='released',shop_id=?,updated_at=? WHERE scope=? AND id=? AND ${guard}`).bind(shop.id,now,scope,id,scope,rid));
  }
  if(new Set(lines.map(l=>l.key)).size!==lines.length)throw new Error('所选暂存记录包含重复订单商品，请逐笔核对');
  ss.push(d.prepare(`INSERT INTO batches(scope,id,filename,created_at,total,valid,complete,test_mode) SELECT ?,?,?,?,?,?,1,0 WHERE ${guard}`).bind(scope,batch,'店铺补齐后正式导入',now,lines.length,lines.filter(l=>isValid(l.status)).length,scope,rid));
  for(const line of lines)await appendOrderImport(line,d,scope,now,rid,batch,ss,guard,v);
  await appendAutoPrintAccounting(d,scope,lines,now,rid,ss,guard);appendShopSnapshots(d,scope,ss,now,rid,guard,lines.map(l=>l.key));return true;
 }
 return false;
}
