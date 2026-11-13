export async function readInventoryEntries(d:D1Database,scope:string,b:Record<string,any>){
 const page=Number(b.page??1),search=String(b.search??'').trim();
 if(!Number.isSafeInteger(page)||page<1||search.length>200)throw Error('查询条件无效');
 return (await d.prepare("SELECT * FROM inventory_entries WHERE scope=? AND instr(lower(reference||' '||note||' '||items),lower(?))>0 ORDER BY created_at DESC,id LIMIT 30 OFFSET ?").bind(scope,search,(page-1)*30).all()).results;
}
export function appendEntryRecord(d:D1Database,ss:D1PreparedStatement[],scope:string,rid:string,guard:string,type:string,reference:string,key:string,items:unknown[],note:string,operator:string,at:number,now:number){
 ss.push(d.prepare(`INSERT INTO inventory_entries(scope,id,type,reference,order_key,items,note,operator,received_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,rid,type,reference,key,JSON.stringify(items),note,operator,at,now,scope,rid));
}
export async function appendInventoryEntry(b:Record<string,any>,d:D1Database,scope:string,account:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='inventory_entry')return false;
 const note=String(b.note??'').trim(),operator=String(b.operator??'').trim(),at=Number(b.at);
 if(!note||note.length>1000||!operator||operator.length>100||!Number.isSafeInteger(at)||at>now+60000||at<946684800000)throw Error('请填写入库来源、经办人和有效收货时间');
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>150)throw Error('请选择1～150项入库货品');
 const seen=new Set<string>(),saved=[];
 for(const item of b.items){
  const {kind,code,quantity:n}=item;
  if(!['physical','product'].includes(kind)||typeof code!=='string'||seen.has(kind+code)||!Number.isSafeInteger(n)||n<=0||n>100000000)throw Error('入库货品重复或数量无效');seen.add(kind+code);
  const table=kind==='physical'?'physical_stocks':'products',eligible=kind==='physical'?"archived=0 AND (NOT EXISTS(SELECT 1 FROM stock_rules r WHERE r.scope=physical_stocks.scope AND r.stock_code=physical_stocks.code) OR EXISTS(SELECT 1 FROM stock_rules r JOIN products p ON p.scope=r.scope AND p.code=r.sales_code LEFT JOIN product_supply_profiles f ON f.scope=p.scope AND f.code=p.code WHERE r.scope=physical_stocks.scope AND r.stock_code=physical_stocks.code AND p.tracking_enabled=1 AND COALESCE(json_extract(f.config,'$.variant.supply_mode'),'现货') NOT IN ('打印定制','定制订单')))":"stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0) AND NOT EXISTS(SELECT 1 FROM product_supply_profiles f WHERE f.scope=products.scope AND f.code=products.code AND json_extract(f.config,'$.variant.supply_mode') IN ('打印定制','定制订单'))";
  const row=await d.prepare(`SELECT * FROM ${table} WHERE scope=? AND code=? AND ${eligible}`).bind(scope,code).first<any>();
  if(!row||row.quantity==null||row.count_at==null)throw Error('请先确认原有库存，再登记增加数量：'+code);
  if(at<=row.count_at)throw Error('本次收货时间必须晚于最近盘点，避免重复入库：'+code);
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND ${eligible} AND quantity IS NOT NULL AND count_at=? AND unit=?) THEN json('库存资料已变化') ELSE 1 END`).bind(scope,rid,scope,code,row.count_at,row.unit));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(n,now,scope,code,scope,rid));
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,effective_at,reference,unit) SELECT ?,?,?,?,'其他入库',?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,kind,n,note+'；经办人：'+operator,now,at,rid,row.unit,scope,rid));
  saved.push({kind,code,name:row.name,unit:row.unit,quantity:n});
 }
 appendEntryRecord(d,ss,scope,rid,guard,'其他入库',String(b.reference??'').slice(0,200),'',saved,note,operator+' / '+account,at,now);return true;
}
