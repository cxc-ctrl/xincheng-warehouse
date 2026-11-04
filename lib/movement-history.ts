import {cutoffTime} from './order-policy';
import {isPrintOnly,isValid,stockReadiness,stockUnit,type OrderLine,type OrderStock,type PhysicalStock,type Product,type StockRule} from './model';
import {printJobLines,type PrintJob} from './printing';
import {supplyProducts} from './product-supply-view';
import type {DigitFulfillment} from './digit-colors';

export type HistoryMovement={id:string;code:string;name:string;kind:string;unit:string;type:string;delta:number;note:string;at:number;effective_at:number|null;reference:string;order_id:string|null;shop:string|null;sales_code:string|null};
export type HistoryPage<T>={rows:T[];total:number;page:number;size:number;pages:number};
export type AuditDeduction={code:string;name:string;unit:string;quantity:number;last_at:number|null};
export type AuditLine={key:string;code:string;title:string;spec:string;quantity:number;erp_status:string;status:string;reason:string;needs_review:boolean;buyer_remark:string;seller_remark:string;color:string;deductions:AuditDeduction[]};
export type AuditOrder={shop:string;order_id:string;lines:AuditLine[]};
export type MovementHistory={movements:HistoryPage<HistoryMovement>;orders:HistoryPage<AuditOrder>|null;as_of:number};
const escapeLike=(q:string)=>'%'+q.replace(/[\\%_]/g,'\\$&')+'%';
const pageNumber=(s:string|null)=>s&&/^\d+$/.test(s)?Math.min(10000000,Math.max(1,Number(s))):1;
const pagination=(total:number,page:number,size:number)=>({total,page:Math.min(page,Math.max(1,Math.ceil(total/size))),size,pages:Math.max(1,Math.ceil(total/size))});

export async function readMovementHistory(d:D1Database,scope:string,params:URLSearchParams):Promise<MovementHistory>{
 const q=(params.get('q')??'').trim();if(q.length>160)throw new Error('搜索内容最多160个字');
 const now=Date.now(),requested=Number(params.get('as_of')),as_of=Number.isSafeInteger(requested)&&requested>0?Math.min(requested,now):now;
 const size=[20,50,100].includes(Number(params.get('size')))?Number(params.get('size')):20;
 const joins=`FROM movements m LEFT JOIN orders o ON o.scope=m.scope AND o.key=m.reference
 LEFT JOIN products p ON p.scope=m.scope AND p.code=m.code AND m.kind!='physical'
 LEFT JOIN physical_stocks s ON s.scope=m.scope AND s.code=m.code AND m.kind='physical'`;
 const fields=['m.code','m.note','m.reference','o.order_id','o.shop','o.code','o.title','p.name','s.name'];
 const where=`m.scope=? AND m.at<=?${q?' AND ('+fields.map(f=>`${f} LIKE ? ESCAPE '\\'`).join(' OR ')+')':''}`;
 const args=[scope,as_of,...(q?fields.map(()=>escapeLike(q)):[])];
 const count=await d.prepare(`SELECT COUNT(*) total ${joins} WHERE ${where}`).bind(...args).first<{total:number}>();
 const paging=pagination(count?.total??0,pageNumber(params.get('page')),size);
 const rows=(await d.prepare(`SELECT m.*,COALESCE(s.name,p.name,m.code) name,
 COALESCE(NULLIF(m.unit,''),s.unit,p.unit,'') unit,o.order_id,o.shop,o.code sales_code
 ${joins} WHERE ${where} ORDER BY m.at DESC,m.id DESC LIMIT ? OFFSET ?`).bind(...args,size,(paging.page-1)*size).all<HistoryMovement>()).results;
 return {movements:{...paging,rows},orders:q?await readAuditOrders(d,scope,q,pageNumber(params.get('order_page'))):null,as_of};
}

async function readAuditOrders(d:D1Database,scope:string,q:string,page:number):Promise<HistoryPage<AuditOrder>>{
 // Select matching ORDER GROUPS first, then load every line in each selected
 // group. Filtering the lines themselves would hide a failed sibling SKU.
 const fields=['o.order_id','o.shop','o.code','o.title','o.spec','p.name','o.buyer_remark','o.seller_remark'];
 const matching=`SELECT o.shop,o.order_id,MAX(o.order_time) latest FROM orders o
 LEFT JOIN products p ON p.scope=o.scope AND p.code=o.code WHERE o.scope=? AND (
 ${fields.map(f=>`${f} LIKE ? ESCAPE '\\'`).join(' OR ')} OR EXISTS(
 SELECT 1 FROM order_stocks os LEFT JOIN physical_stocks s ON s.scope=os.scope AND s.code=os.stock_code
 WHERE os.scope=o.scope AND os.order_key=o.key AND (os.stock_code LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')))
 GROUP BY o.shop,o.order_id`;
 const args=[scope,...Array(fields.length+2).fill(escapeLike(q))];
 const count=await d.prepare(`SELECT COUNT(*) total FROM (${matching})`).bind(...args).first<{total:number}>();
 const paging=pagination(count?.total??0,page,10);
 const groups=(await d.prepare(`${matching} ORDER BY latest DESC,shop,order_id LIMIT ? OFFSET ?`).bind(...args,paging.size,(paging.page-1)*paging.size).all<{shop:string;order_id:string}>()).results;
 if(!groups.length)return {...paging,rows:[]};
 const groupJson=JSON.stringify(groups),groupMatch=`EXISTS(SELECT 1 FROM json_each(?) g WHERE json_extract(g.value,'$.shop')=o.shop AND json_extract(g.value,'$.order_id')=o.order_id)`;
 const orders=(await d.prepare(`SELECT o.* FROM orders o WHERE o.scope=? AND ${groupMatch} ORDER BY o.shop,o.order_id,o.key`).bind(scope,groupJson).all<OrderLine>()).results;
 const keys=JSON.stringify(orders.map(o=>o.key)),codes=JSON.stringify([...new Set(orders.map(o=>o.code))]);
 const results=await d.batch([
  d.prepare('SELECT * FROM products WHERE scope=? AND code IN(SELECT value FROM json_each(?))').bind(scope,codes),
  d.prepare('SELECT * FROM stock_rules WHERE scope=? AND sales_code IN(SELECT value FROM json_each(?))').bind(scope,codes),
  d.prepare('SELECT * FROM order_stocks WHERE scope=? AND order_key IN(SELECT value FROM json_each(?))').bind(scope,keys),
  d.prepare('SELECT * FROM digit_fulfillments WHERE scope=? AND order_key IN(SELECT value FROM json_each(?))').bind(scope,keys),
  d.prepare('SELECT order_key,reason FROM order_conflicts WHERE scope=? AND order_key IN(SELECT value FROM json_each(?))').bind(scope,keys),
  d.prepare(`SELECT j.* FROM print_jobs j WHERE j.scope=? AND EXISTS(SELECT 1 FROM json_each(?) g WHERE json_extract(g.value,'$.shop')=j.shop AND json_extract(g.value,'$.order_id')=j.order_id)`).bind(scope,groupJson),
  d.prepare('SELECT reference,code,kind,MAX(at) last_at FROM movements WHERE scope=? AND reference IN(SELECT value FROM json_each(?)) AND delta<0 GROUP BY reference,code,kind').bind(scope,keys),
  d.prepare('SELECT import_test_mode FROM warehouse_settings WHERE scope=?').bind(scope),
  d.prepare('SELECT * FROM order_effective_rules WHERE scope=? AND order_key IN(SELECT value FROM json_each(?))').bind(scope,keys),
 ]);
 const products=await supplyProducts(d,scope,results[0].results as Product[]),rules=results[1].results as StockRule[],deductions=results[2].results as OrderStock[];
 const routes=results[8].results as (StockRule&{order_key:string;allocated_qty:number|null})[];
 const stockCodes=JSON.stringify([...new Set([...rules,...deductions,...routes].map(r=>r.stock_code))]);
 const stocks=(await d.prepare('SELECT * FROM physical_stocks WHERE scope=? AND code IN(SELECT value FROM json_each(?))').bind(scope,stockCodes).all<PhysicalStock>()).results;
 const choices=new Map((results[3].results as DigitFulfillment[]).map(r=>[r.order_key,r])),conflicts=new Map((results[4].results as {order_key:string;reason:string}[]).map(r=>[r.order_key,r.reason]));
 const jobs=results[5].results as PrintJob[],times=results[6].results as {reference:string;code:string;kind:string;last_at:number}[],ignoreCutoff=(results[7].results[0] as {import_test_mode:number}|undefined)?.import_test_mode===1;
 const pmap=new Map(products.map(p=>[p.code,p])),smap=new Map(stocks.map(s=>[s.code,s]));
 const lines=orders.map(o=>{
  const p=pmap.get(o.code),choice=choices.get(o.key),job=jobs.find(j=>j.shop===o.shop&&j.order_id===o.order_id);
  const printing=choice?.status==='print'||!!job&&printJobLines(job,[o]).length>0;
  const actual:AuditDeduction[]=deductions.filter(s=>s.order_key===o.key&&s.deducted_qty>0).map(s=>({code:s.stock_code,name:smap.get(s.stock_code)?.name??s.stock_code,unit:stockUnit(smap.get(s.stock_code)),quantity:s.deducted_qty,last_at:times.find(t=>t.reference===o.key&&t.code===s.stock_code&&t.kind==='physical')?.last_at??null}));
  if((o.deducted_qty??0)>0)actual.unshift({code:o.code,name:p?.name??o.title,unit:p?.unit??'份',quantity:o.deducted_qty!,last_at:times.find(t=>t.reference===o.key&&t.code===o.code&&t.kind!=='physical')?.last_at??null});
  const reasons:string[]=[];
  if(conflicts.has(o.key))reasons.push('导入数据冲突：'+conflicts.get(o.key));
  if(!printing&&choice?.status==='pending')reasons.push(choice.reason||'数字贴备注待人工核对');
  if(o.review===1)reasons.push('退货、状态或数量变化待核对');
  const selected=routes.filter(r=>r.order_key===o.key),routed={...o,stock_items:selected.map(r=>({stock_code:r.stock_code,per_unit:r.per_unit}))};
  if(!printing&&cutoffTime(routed,products,stocks,rules,ignoreCutoff)!=null)reasons.push('未提供发货时间，请核对是否已包含在盘点中');
  let status=actual.length?'已记录扣减':'未扣库存',reason='';
  if(printing){status=actual.length?'打印订单 · 有历史扣减':'打印 · 不扣现货';reason='已归入打印；请结合下方流水查看是否有回补或历史扣减。';}
  else if(!p){reasons.push('销售SKU未建立对应商品');}
  else if(isPrintOnly(p)){reason='商品为打印／定制类型，不扣现货库存';}
  else if(p.tracking_enabled===0){reason='商品设置为仅统计销售，不扣库存';}
  else if(!isValid(o.status)&&!(o.shipped_qty??0)){reason='尚未达到已发货／已完成状态';}
  else if(!reasons.length){
   const readiness=stockReadiness(p,selected.length?selected:rules,smap);
   if(!readiness.ready)reasons.push(readiness.detail);
   else if(!actual.length)reason='没有当前扣减记录；请核对订单发货时间、库存起算时间及关联。';
   else reason='下列数量来自已保存的扣减记录；具体扣减、回补和调整见流水。';
  }
  if(reasons.length){status=actual.length?'待核对 · 已有扣减':'待核对 · 未扣库存';reason=reasons.join('；');}
  return {shop:o.shop,order_id:o.order_id,line:{key:o.key,code:o.code,title:p?.name||o.title,spec:o.spec,quantity:o.quantity,erp_status:o.status,status,reason,needs_review:reasons.length>0,buyer_remark:o.buyer_remark??'',seller_remark:o.seller_remark??'',color:choice?.color??'',deductions:actual} satisfies AuditLine};
 });
 return {...paging,rows:groups.map(g=>({...g,lines:lines.filter(l=>l.shop===g.shop&&l.order_id===g.order_id).map(l=>l.line)}))};
}
