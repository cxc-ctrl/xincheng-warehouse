import {DEFAULT_ANALYTICS,DEFAULT_POLICY,parseDay,type AnalyticsData,type AnalyticsSettings,type ProductLifecycle,type HealthPolicy} from './business-analysis';
export async function readAnalytics(d:D1Database,scope:string):Promise<AnalyticsData>{
 const [settings,meta,inbound]=await d.batch([d.prepare('SELECT payload,updated_at FROM analytics_settings WHERE scope=?').bind(scope),d.prepare('SELECT l.payload,l.updated_at FROM product_lifecycle l JOIN products p ON p.scope=l.scope AND p.code=l.code WHERE l.scope=?').bind(scope),d.prepare("SELECT kind,code,MIN(COALESCE(effective_at,at)) AS first_at,SUM(delta) AS total FROM movements WHERE scope=? AND type IN ('补货入库','纸张补货入库','实物补货入库','采购入库') AND delta>0 GROUP BY kind,code").bind(scope)]);
 const s=settings.results[0] as {payload:string;updated_at:number}|undefined;
 return {analyticsSettings:s?{...JSON.parse(s.payload),updated_at:s.updated_at}:DEFAULT_ANALYTICS,productLifecycle:meta.results.map((r:any)=>({...JSON.parse(r.payload),updated_at:r.updated_at})),inventoryReceipts:inbound.results as AnalyticsData['inventoryReceipts']};
}
function date(v:unknown){if(typeof v!=='string'||(v!==''&&(!Number.isFinite(parseDay(v))||v<'2000-01-01'||v>'2099-12-31')))throw new Error('日期格式不正确');return v;}
function text(v:unknown,max=160){if(typeof v!=='string'||v.length>max)throw new Error('字段格式不正确');return v.trim();}
function num(v:unknown,max=100000000){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)throw new Error('请填写有效的非负数');return v;}
function version(v:unknown){const n=num(v,1e15);if(!Number.isSafeInteger(n))throw new Error('版本无效，请刷新');return n;}
export async function appendAnalyticsAction(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action==='analytics_settings'){
  const raw=b.settings??{},value:AnalyticsSettings={updated_at:version(raw.updated_at),minimum_sales:num(raw.minimum_sales,1e7),coverage_start:date(raw.coverage_start),coverage_end:date(raw.coverage_end),categories:{}};
  if(!!value.coverage_start!==!!value.coverage_end||value.coverage_start>value.coverage_end)throw new Error('请填写完整、连续的订单覆盖起止日期');
  if(!raw.categories||typeof raw.categories!=='object'||Array.isArray(raw.categories)||Object.keys(raw.categories).length>500)throw new Error('品类规则不正确');
  for(const [cat,rawP] of Object.entries(raw.categories)){const p=rawP as HealthPolicy,category=text(cat);if(!category||['__proto__','constructor','prototype'].includes(category))throw new Error('品类名称无效');const policy={...DEFAULT_POLICY};for(const k of ['urgent','low','normal','high','stale','high_value'] as const)policy[k]=num(p[k],k==='high_value'?1e10:3650);policy.holiday=date(p.holiday);if(!(policy.urgent<policy.low&&policy.low<policy.normal&&policy.normal<policy.high)||policy.stale<1)throw new Error('库存天数阈值应从小到大，滞销天数至少为1');value.categories[category]=policy;}
  const old=await d.prepare('SELECT updated_at FROM analytics_settings WHERE scope=?').bind(scope).first<{updated_at:number}>();if((old?.updated_at??0)!==value.updated_at)throw new Error('统计规则已更新，请刷新后重试');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM analytics_settings WHERE scope=?),0)<>? THEN json('统计规则已变化') ELSE 1 END`).bind(scope,rid,scope,value.updated_at));
  ss.push(d.prepare(`INSERT INTO analytics_settings(scope,payload,updated_at) SELECT ?,?,? WHERE ${guard} ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(scope,JSON.stringify(value),Math.max(now,value.updated_at+1),scope,rid));return true;
 }
 if(b.action==='product_lifecycle'){
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw new Error('每次最多保存100个SKU的经营资料');const seen=new Set<string>();
  for(const raw of b.items){const p:ProductLifecycle={code:text(raw.code),launch:date(raw.launch),series:text(raw.series),cohort:text(raw.cohort),on_sale:raw.on_sale,updated_at:version(raw.updated_at)};if(typeof p.on_sale!=='boolean'||!p.code||seen.has(p.code))throw new Error('商品编码或在售状态不正确');seen.add(p.code);
   if(!await d.prepare('SELECT 1 FROM products WHERE scope=? AND code=?').bind(scope,p.code).first())throw new Error('商品不存在：'+p.code);
   const old=await d.prepare('SELECT updated_at FROM product_lifecycle WHERE scope=? AND code=?').bind(scope,p.code).first<{updated_at:number}>();if((old?.updated_at??0)!==p.updated_at)throw new Error('商品经营资料已更新，请刷新：'+p.code);
   ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (COALESCE((SELECT updated_at FROM product_lifecycle WHERE scope=? AND code=?),0)<>? OR NOT EXISTS(SELECT 1 FROM products WHERE scope=? AND code=?)) THEN json('经营资料已变化') ELSE 1 END`).bind(scope,rid,scope,p.code,p.updated_at,scope,p.code));
   ss.push(d.prepare(`INSERT INTO product_lifecycle(scope,code,payload,updated_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(scope,code) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(scope,p.code,JSON.stringify(p),Math.max(now,p.updated_at+1),scope,rid));
  }return true;
 }return false;
}
