type Obj=Record<string,any>;
const text=(s:unknown,max=500)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw new Error('请填写有效的原因和经办人');return s.trim();};
export async function readStockLosses(d:D1Database,scope:string,b:Obj){
 const month=String(b.month??'');if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('请选择月份');
 const start=Date.parse(month+'-01T00:00:00+08:00'),dt=new Date(start+8*3600000);dt.setUTCMonth(dt.getUTCMonth()+1);const end=dt.getTime()-8*3600000;
 const page=Number(b.page??1);if(!Number.isInteger(page)||page<1||page>100000)throw new Error('页码无效');
 const filter='scope=? AND id IN(SELECT loss_id FROM stock_loss_events WHERE scope=stock_losses.scope AND at>=? AND at<?)';
 const rows=(await d.prepare(`SELECT * FROM stock_losses WHERE ${filter} ORDER BY created_at DESC,id LIMIT 30 OFFSET ?`).bind(scope,start,end,(page-1)*30).all()).results;
 const total=await d.prepare(`SELECT count(*) n FROM stock_losses WHERE ${filter}`).bind(scope,start,end).first<{n:number}>();
 const events=(await d.prepare('SELECT * FROM stock_loss_events WHERE scope=? AND loss_id IN(SELECT value FROM json_each(?)) ORDER BY at,id').bind(scope,JSON.stringify((rows as Obj[]).map(r=>r.id))).all()).results;
 const summary=await d.prepare("SELECT COALESCE(sum(amount_cents),0) amount_cents,COALESCE(sum(CASE WHEN event='报损出库' THEN 1 ELSE 0 END),0) count,COALESCE(sum(CASE WHEN event IN('报损出库','撤销报损') AND amount_cents IS NULL THEN 1 ELSE 0 END),0) missing_cost FROM stock_loss_events WHERE scope=? AND at>=? AND at<?").bind(scope,start,end).first();
 return {rows,events,total:total?.n??0,page,summary};
}
export async function appendStockLoss(b:Obj,d:D1Database,scope:string,account:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(!['stock_loss_create','stock_loss_destroy','stock_loss_void'].includes(b.action))return false;
 const reason=text(b.reason),operator=text(b.operator,100);
 const event=(id:string,name:string,amount:number|null)=>ss.push(d.prepare(`INSERT INTO stock_loss_events(scope,id,loss_id,event,note,operator,account,at,amount_cents) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),id,name,reason,operator,account,now,amount,scope,rid));
 const movement=(r:Obj,type:string,delta:number,note:string)=>ss.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),r.code,r.kind,type,delta,note,now,'loss:'+r.id,r.unit,scope,rid));
 const getStock=async(kind:string,code:string)=>{
  if(!['physical','product'].includes(kind))throw new Error('请选择实物库存');
  const table=kind==='physical'?'physical_stocks':'products';
  const clause=kind==='physical'?'archived=0':"stock_mode='direct' AND tracking_enabled=1 AND count_at>=COALESCE(tracking_at,0)";
  const row=await d.prepare(`SELECT * FROM ${table} WHERE scope=? AND code=? AND ${clause}`).bind(scope,code).first<Obj>();
  if(!row||row.quantity==null||row.count_at==null)throw new Error('请先盘点这款货品，再登记报损');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND ${clause} AND updated_at=? AND quantity=? AND count_at=? AND cost IS ?) THEN json('库存已变化') ELSE 1 END`).bind(scope,rid,scope,code,row.updated_at,row.quantity,row.count_at,row.cost));
  return {table,row};
 };
 if(b.action==='stock_loss_create'){
  const code=text(b.code,160),kind=b.kind,type=b.loss_type;if(!['损坏','销毁'].includes(type))throw new Error('请选择损坏或销毁');
  const q=b.quantity;if(!Number.isSafeInteger(q)||q<1||q>100000000)throw new Error('报损数量须为正整数');
  const {table,row}=await getStock(kind,code);if(q>row.quantity)throw new Error('报损数量超过当前库存，请先核对实际数量');
  if(row.quantity!==b.expected_quantity||row.cost!==b.expected_cost)throw new Error('库存资料已变化，请关闭弹窗刷新后重试');
  const id=crypto.randomUUID(),amount=row.cost==null?null:Math.round(row.cost*q*100);if(amount!=null&&!Number.isSafeInteger(amount))throw new Error('报损金额过大');
  ss.push(d.prepare(`INSERT INTO stock_losses(scope,id,kind,code,name,unit,loss_type,quantity,unit_cost,amount_cents,before_qty,after_qty,reason,operator,account,created_at,updated_at,destroyed_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(scope,id,kind,code,row.name,row.unit,type,q,row.cost,amount,row.quantity,row.quantity-q,reason,operator,account,now,now,type==='销毁'?now:null,scope,rid));
  ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity-?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(q,now,scope,code,scope,rid));
  event(id,'报损出库',amount);movement({...row,kind,id},type+'出库',-q,`${reason}；经办人：${operator}；库存 ${row.quantity} → ${row.quantity-q} ${row.unit}；损失 ${amount==null?'成本待补':(amount/100).toFixed(2)+'元'}`);
 }else{
  const id=text(b.id,160),r=await d.prepare('SELECT * FROM stock_losses WHERE scope=? AND id=?').bind(scope,id).first<Obj>();
  if(!r||r.voided_at)throw new Error('记录不存在或已撤销');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM stock_losses WHERE scope=? AND id=? AND updated_at=? AND destroyed_at IS ? AND voided_at IS NULL) THEN json('报损记录已变化') ELSE 1 END`).bind(scope,rid,scope,id,r.updated_at,r.destroyed_at));
  if(b.action==='stock_loss_destroy'){
   if(r.destroyed_at)throw new Error('已记录销毁，不要重复登记');
   ss.push(d.prepare(`UPDATE stock_losses SET destroyed_at=?,updated_at=? WHERE scope=? AND id=? AND ${guard}`).bind(now,now,scope,id,scope,rid));event(id,'补记销毁',0);movement(r,'补记销毁',0,`${reason}；经办人：${operator}；已报损 ${r.quantity}${r.unit}，本次不重复扣库存`);
  }else{
   const {table,row}=await getStock(r.kind,r.code);if(row.count_at>r.created_at)throw new Error('报损后已重新盘点，不能直接回补，请核对后重新盘点纠正库存');
   ss.push(d.prepare(`UPDATE ${table} SET quantity=quantity+?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(r.quantity,now,scope,r.code,scope,rid));
   ss.push(d.prepare(`UPDATE stock_losses SET voided_at=?,updated_at=? WHERE scope=? AND id=? AND ${guard}`).bind(now,now,scope,id,scope,rid));event(id,'撤销报损',r.amount_cents==null?null:-r.amount_cents);movement(r,'撤销报损',r.quantity,`${reason}；经办人：${operator}；库存 ${row.quantity} → ${row.quantity+r.quantity} ${r.unit}；撤销原损失金额`);
  }
 }
 return true;
}
