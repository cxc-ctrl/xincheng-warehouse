import {appendEntryRecord} from './inventory-entry-actions';
import {type Purchase,type PurchaseList} from './purchasing';
function text(value:unknown,max=160){if(typeof value!=='string'||value.length>max)throw new Error('采购信息格式不正确');return value.trim();}
function kind(value:unknown){if(value!=='physical'&&value!=='product')throw new Error('请选择具体实物或独立成品');return value;}
async function target(d:D1Database,scope:string,k:string,code:string){
 const query=k==='physical'?"SELECT code,name,spec,unit,quantity,count_at,cost FROM physical_stocks WHERE scope=? AND code=? AND archived=0":"SELECT code,name,spec,unit,quantity,count_at,cost FROM products WHERE scope=? AND code=? AND stock_mode='direct' AND tracking_enabled=1 AND COALESCE(count_at,0)>=COALESCE(tracking_at,0) AND NOT EXISTS(SELECT 1 FROM product_supply_profiles s WHERE s.scope=products.scope AND s.code=products.code AND json_extract(s.config,'$.variant.supply_mode') IN ('打印定制','定制订单'))";
 const row=await d.prepare(query).bind(scope,code).first<{code:string;name:string;spec:string;unit:string;quantity:number|null;count_at:number|null;cost:number|null}>();
 if(!row)throw new Error('货品不存在、已停用，或需先关联实际库存');return row;
}
export async function readPurchaseDefaults(d:D1Database,scope:string,b:Record<string,any>){
 const k=kind(b.kind),code=text(b.code);const t=await target(d,scope,k,code);
 const defaults=await d.prepare('SELECT supplier,unit,unit_price FROM purchase_defaults WHERE scope=? AND kind=? AND code=?').bind(scope,k,code).first<{supplier:string;unit:string;unit_price:number}>();
 return {supplier:defaults?.supplier??'',unit:t.unit,unit_price:defaults?.unit===t.unit?defaults.unit_price:t.cost,first:!defaults};
}
export async function readPurchases(d:D1Database,scope:string,b:Record<string,any>):Promise<PurchaseList>{
 const month=text(b.month??'',7),status=text(b.status??''),search=text(b.search??'',200),page=Number(b.page??1);
 if(month&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('采购月份无效');
 if(status&&!['pending','received','cancelled'].includes(status))throw new Error('采购状态无效');
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new Error('页码无效');
 const where=['scope=?'],args:(string|number)[]=[scope];
 if(b.target_kind!=null||b.target_code!=null){where.push('kind=? AND code=?');args.push(kind(b.target_kind),text(b.target_code));}
 if(month){const start=Date.parse(month+'-01T00:00:00+08:00'),end=new Date(start+8*3600000);end.setUTCMonth(end.getUTCMonth()+1);where.push('created_at>=? AND created_at<?');args.push(start,end.getTime()-8*3600000);}
 if(status){where.push('status=?');args.push(status);}
 if(search){where.push("instr(lower(name||' '||code||' '||supplier||' '||id),lower(?))>0");args.push(search);}
 const clause=where.join(' AND ');
 const summary=await d.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN status!='cancelled' THEN amount_cents ELSE 0 END),0) AS amount_cents,COALESCE(SUM(status='pending'),0) AS pending,COALESCE(SUM(status='received'),0) AS received,COALESCE(SUM(status='cancelled'),0) AS cancelled FROM purchase_orders WHERE ${clause}`).bind(...args).first<Omit<PurchaseList,'rows'|'page'>>();
 const rows=await d.prepare(`SELECT * FROM purchase_orders WHERE ${clause} ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?`).bind(...args,(page-1)*30).all<Purchase>();
 return {...summary!,rows:rows.results,page};
}
export async function appendPurchase(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(!['purchase_create','purchase_receive','purchase_cancel'].includes(b.action))return false;
 if(b.action==='purchase_create'){
  const k=kind(b.kind),code=text(b.code),p=await target(d,scope,k,code),n=b.quantity,amount=b.amount;
  if(!Number.isSafeInteger(n)||n<=0||n>100000000)throw new Error('采购数量必须是1～100000000的整数');
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>100000000)throw new Error('请填写有效采购总金额，免费采购可填0');
  const cents=Math.round((amount+Number.EPSILON)*100),supplier=text(b.supplier??'',200),note=text(b.note??'',1000);
  // Snapshot the purchase identity and price. Buying never mutates inventory or historic costs.
  ss.push(d.prepare(`INSERT INTO purchase_orders(scope,id,kind,code,name,spec,unit,quantity,amount_cents,supplier,note,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,'pending',?,? WHERE ${guard}`).bind(scope,rid,k,code,p.name,p.spec,p.unit,n,cents,supplier,note,now,now,scope,rid));
  ss.push(d.prepare(`INSERT INTO purchase_defaults(scope,kind,code,supplier,unit,unit_price,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,kind,code) DO UPDATE SET supplier=excluded.supplier,unit=excluded.unit,unit_price=excluded.unit_price,updated_at=excluded.updated_at`).bind(scope,k,code,supplier,p.unit,cents/100/n,now,scope,rid));
  return true;
 }
 const id=text(b.id,200),p=await d.prepare('SELECT * FROM purchase_orders WHERE scope=? AND id=?').bind(scope,id).first<Purchase>();
 if(!p)throw new Error('采购单不存在');if(p.status!=='pending')throw new Error('这笔采购已处理，请刷新；不会重复入库');
 // Recheck in the same transaction: two requests with different IDs cannot receive the same purchase twice.
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM purchase_orders WHERE scope=? AND id=? AND status='pending') THEN json('采购已处理，请刷新') ELSE 1 END`).bind(scope,rid,scope,id));
 if(b.action==='purchase_receive'){
  const t=await target(d,scope,p.kind,p.code);
  if(t.unit!==p.unit)throw new Error('货品库存单位已改变，请取消采购后按新单位重新登记');
  if(t.quantity==null||t.count_at==null)throw new Error('请先盘点该货品原有库存（没有库存请填0），再确认采购入库');
  const table=p.kind==='physical'?'physical_stocks':'products';
  const eligible=p.kind==='physical'?'archived=0':"stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0)";
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND unit=? AND quantity IS NOT NULL AND count_at IS NOT NULL AND ${eligible}) THEN json('库存资料已变化，请刷新') ELSE 1 END`).bind(scope,rid,scope,p.code,p.unit));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,cost=COALESCE(cost,?),updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(p.quantity,p.amount_cents/100/p.quantity,now,scope,p.code,scope,rid));
  appendEntryRecord(d,ss,scope,rid,guard,'采购入库',id,'',[{kind:p.kind,code:p.code,name:p.name,unit:p.unit,quantity:p.quantity}],p.note||'采购到货',String(b.operator||'仓库管理员'),now,now);
  // Existing costs stay unchanged. Only a previously missing cost gets its first purchase price.
  ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,?, '采购入库',?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),p.code,p.kind,p.quantity,`采购 ${p.id} · ${p.supplier||'未填写供应商'} · 金额 ${(p.amount_cents/100).toFixed(2)}元`,now,id,p.unit,scope,rid));
 }
 ss.push(d.prepare(`UPDATE purchase_orders SET status=?,received_at=?,updated_at=? WHERE scope=? AND id=? AND ${guard}`).bind(b.action==='purchase_receive'?'received':'cancelled',b.action==='purchase_receive'?now:null,now,scope,id,scope,rid));
 return true;
}
