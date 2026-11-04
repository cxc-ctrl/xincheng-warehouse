type Validators={str:(value:unknown,max?:number)=>string};

// Withdraw a mistaken baseline without deleting sales, recipes or audit history.
// Recounting later uses appendInventoryCount to rebase deductions at the new time.
export async function appendRevokeCount(b:Record<string,unknown>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,v:Validators){
 if(b.kind!=="physical"&&b.kind!=="product")throw new Error("请选择实物库存或独立成品");
 const code=v.str(b.code),reason=v.str(b.reason,300);
 if(!code||!reason)throw new Error("请填写库存编码和撤销原因");
 const quantity=b.expected_quantity,at=b.expected_count_at;
 if(typeof quantity!=="number"||!Number.isSafeInteger(quantity)||!(at===null||(typeof at==="number"&&Number.isSafeInteger(at))))throw new Error("库存信息已变化，请刷新后重新撤销");
 const physical=b.kind==="physical",table=physical?"physical_stocks":"products";
 const active=physical?"archived=0":"stock_mode='direct' AND tracking_enabled=1";
 const current=await d.prepare(`SELECT quantity,count_at,unit FROM ${table} WHERE scope=? AND code=? AND ${active}`).bind(scope,code).first<{quantity:number|null;count_at:number|null;unit:string}>();
 if(!current)throw new Error(physical?"实物不存在或已移除":"请选择管理库存的独立成品；共用库存请撤销对应实物的盘点");
 if(current.quantity==null)throw new Error("这条库存已经是待盘点状态，请刷新查看");
 if(current.quantity!==quantity||current.count_at!==at)throw new Error("库存已被更新，请刷新后核对再撤销");
 // Recheck inside the same transaction: an intervening count/import must not be lost.
 statements.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND quantity IS ? AND count_at IS ? AND ${active}) THEN json('库存已被更新，请刷新后核对再撤销') ELSE 1 END`).bind(scope,rid,scope,code,quantity,at));
 const note=`恢复待盘点；撤销前库存 ${quantity} ${current.unit}；原起算时间 ${at==null?"未设置":new Date(at).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})}；原因：${reason}。保留历史订单和扣减规则，重新盘点后按新的起算时间扣减。`;
 statements.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,?,'撤销盘点',0,?,?,?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),code,b.kind,note,now,rid,current.unit,scope,rid));
 statements.push(d.prepare(`UPDATE ${table} SET quantity=NULL,count_at=NULL,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(now,scope,code,scope,rid));
}
