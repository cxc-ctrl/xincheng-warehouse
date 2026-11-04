import {isValid,type OrderLine} from './model';

export type FreightBill={tracking:string;month:string;carrier:string;fee_cents:number;raw_fee?:string;filename:string;batch_id:string;updated_at:number};
export type FreightPeriod={month:string;packing_cents:number|null;updated_at:number};
export type FreightImport={id:string;month:string;filename:string;total:number;skipped:number;processed:number;complete:number;created_at:number;carrier_profile?:string};
export type PackingSettings={fee_cents:number|null;updated_at:number};
export type FreightData={pendingImportOrders?:string[];packingSettings?:PackingSettings;freightBills:FreightBill[];freightPeriods:FreightPeriod[];freightImports:FreightImport[]};
export const EMPTY_FREIGHT:FreightData={freightBills:[],freightPeriods:[],freightImports:[]};
export const monthOf=(at:number)=>new Date(at+8*3600000).toISOString().slice(0,7);
export function validMonth(v:string){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v))throw new Error('请选择有效的账单月份');return v;}
export function normalizeWaybill(v:string){
 const s=v.normalize('NFKC').trim().replace(/^['’]/,'').replace(/\s/g,'').toUpperCase();
 if(!s||s.length>100||!(/^[A-Z0-9-]+$/).test(s)||/^\d+(?:\.\d+)?E[+-]?\d+$/.test(s))throw new Error('运单号无法识别，请将原表运单号设置为文本，避免科学计数或精度丢失');
 return s;
}
export function splitWaybills(v:string){return [...new Set(v.split(/[,，;；、\n|/]+/).map(s=>s.trim()).filter(Boolean).map(normalizeWaybill))].sort();}
export function cents(v:unknown,label='费用',signed=false){
 const text=String(v??'').trim().replace(/[￥¥元,，\s]/g,'');
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(text))throw new Error(label+'须为最多两位小数的金额');
 const n=Math.round(Number(text)*100);if(!Number.isSafeInteger(n)||Math.abs(n)>1e10||(!signed&&n<0))throw new Error(label+'超出有效范围');return n;
}
export const orderGroup=(o:Pick<OrderLine,'shop'|'order_id'>)=>JSON.stringify([o.shop,o.order_id]);
export function trackingIndex(orders:OrderLine[]){const m=new Map<string,Set<string>>();for(const o of orders)for(const wb of o.tracking_numbers??[]){const keys=m.get(wb)??new Set<string>();keys.add(orderGroup(o));m.set(wb,keys);}return m;}
// Allocate integer cents once per parcel; the remainder goes to a stable order key.
export function allocateCents(value:number,keys:string[]){const sorted=[...new Set(keys)].sort(),out=new Map<string,number>();if(!sorted.length)return out;const sign=value<0?-1:1,abs=Math.abs(value),base=Math.floor(abs/sorted.length),rem=abs%sorted.length;sorted.forEach((k,i)=>out.set(k,sign*(base+(i<rem?1:0))));return out;}

export type ProfitOrder={key:string;order_id:string;shop:string;month:string;lines:OrderLine[];tracking:string[];payment:number|null;refund:number|null;net:number|null;goods:number|null;freight:number|null;packing:number|null;profit:number|null;margin:number|null;reasons:string[];drivers:string[];shared:boolean};
export function buildFreightAnalysis(orders:OrderLine[],data:FreightData,returnKeys:Iterable<string>=[]){
 const index=trackingIndex(orders),bills=new Map(data.freightBills.filter(b=>index.has(b.tracking)).map(b=>[b.tracking,b])),periods=new Map(data.freightPeriods.map(p=>[p.month,p]));
 const freightAlloc=new Map<string,number>(),packingAlloc=new Map<string,number>(),packingMissing=new Set<string>(),shared=new Set<string>();
 for(const b of bills.values()){
  const keys=[...(index.get(b.tracking)??[])];for(const [key,value] of allocateCents(b.fee_cents,keys))freightAlloc.set(key,(freightAlloc.get(key)??0)+value);
  if(data.packingSettings===undefined){const packing=periods.get(b.month)?.packing_cents;if(packing==null)keys.forEach(k=>packingMissing.add(k));else for(const [key,value] of allocateCents(packing,keys))packingAlloc.set(key,(packingAlloc.get(key)??0)+value);}
  if(keys.length>1)keys.forEach(k=>shared.add(k));
 }
 if(data.packingSettings!==undefined){for(const keys of index.values()){const fee=data.packingSettings.fee_cents;if(fee==null)keys.forEach(k=>packingMissing.add(k));else for(const [key,value] of allocateCents(fee,[...keys]))packingAlloc.set(key,(packingAlloc.get(key)??0)+value);if(keys.size>1)keys.forEach(k=>shared.add(k));}}
 const groups=new Map<string,OrderLine[]>();for(const o of orders){const k=orderGroup(o),a=groups.get(k)??[];a.push(o);groups.set(k,a);}
 const returns=new Set(returnKeys),rows:ProfitOrder[]=[];
 for(const [key,lines] of groups){
  if(!lines.some(o=>isValid(o.status)||(o.shipped_qty??0)>0||(o.tracking_numbers?.length??0)>0))continue;
  const tracking=[...new Set(lines.flatMap(o=>o.tracking_numbers??[]))].sort(),matched=tracking.map(w=>bills.get(w)).filter((b):b is FreightBill=>!!b),months=[...new Set(matched.map(b=>b.month))].sort();
  const month=months[0]??monthOf(Math.min(...lines.map(o=>o.shipped_at??o.order_time))),reasons:string[]=[],drivers:string[]=[];
  if(data.pendingImportOrders?.includes(key))reasons.push('导入冲突待复核，订单成本及金额未齐');
  const unique=(values:(number|null|undefined)[],label:string,required=false)=>{const set=new Set(values.filter((v):v is number=>v!=null).map(n=>Math.round(n*100)));if(set.size>1)reasons.push(label+'在订单明细中不一致');if(!set.size&&required)reasons.push('缺'+label);return set.size===1?[...set][0]:null;};
  const payment=unique(lines.map(o=>o.amount),'付款金额'),refund=unique(lines.map(o=>o.refund_amount),'退款金额'),providedNet=unique(lines.map(o=>o.net_amount),'净实收金额');
  if(providedNet!=null&&payment!=null&&refund!=null&&providedNet!==payment-refund)reasons.push('净实收与付款减退款不一致');
  let net=providedNet??(payment==null?null:payment-(refund??0));if(net==null)reasons.push('缺实收金额');
  if(net!=null&&net<0){reasons.push('退款超过付款金额');net=null;}
  if(lines.some(o=>!isValid(o.status)||o.review===1||returns.has(o.key)))reasons.push('售后或订单状态需核对');
  if(providedNet==null&&refund==null&&lines.some(o=>{try{const s=JSON.parse(o.source_details||'null');return s?.kind==='xiaohongshu'&&s.after_sale&&s.after_sale!=='无售后';}catch{return false;}}))reasons.push('小红书售后缺退款或净实收金额');
  let goods:number|null=0;
  const printed=lines.filter(o=>o.fulfillment_mode==='print'),stock=lines.filter(o=>o.fulfillment_mode!=='print');
  if(printed.length){goods=unique(printed.map(o=>o.printing_cost),'数码打印成本');if(printed.some(o=>o.printing_status&&o.printing_status!=='done'))reasons.push('打印商品尚未确认发货或状态需核对');if(printed.some(o=>o.printing_needs_review)){reasons.push('打印规格变更，成本需复核');goods=null;}if(goods==null)reasons.push('打印成本待录入');}
  for(const o of stock){const n=o.unit_cost_snapshot==null?o.cost:o.unit_cost_snapshot*(o.shipped_qty||o.quantity);if(n==null){goods=null;reasons.push('缺货品成本');break;}if(goods!=null)goods+=Math.round(n*100);}
  if(!tracking.length)reasons.push('缺运单号');else if(matched.length<tracking.length)reasons.push('快递账单待到齐');
  if(months.length>1)reasons.push('同一订单包含跨月账单');
  const freight=tracking.length&&matched.length===tracking.length?freightAlloc.get(key)??0:null;
  const packing=(data.packingSettings!==undefined?tracking.length>0:freight!=null)&&!packingMissing.has(key)?packingAlloc.get(key)??0:null;if(packing==null&&tracking.length)reasons.push('未设置打包人工费');
  const profit=!reasons.length&&net!=null&&goods!=null&&freight!=null&&packing!=null?net-goods-freight-packing:null;
  if(profit!=null&&profit<0){if(goods!>=net!)drivers.push('货品成本已达到或超过实收');else{if(goods!>=net!*.6)drivers.push('货品成本占比较高');if(freight!+packing!>net!-goods!)drivers.push('快递及打包费用超过剩余毛利');}if(!drivers.length)drivers.push('总成本超过实收');}
  rows.push({key,order_id:lines[0].order_id,shop:lines[0].shop,month,lines,tracking,payment,refund,net,goods,freight,packing,profit,margin:profit!=null&&net!>0?profit/net!:null,reasons:[...new Set(reasons)],drivers,shared:shared.has(key)});
 }
 return {rows:rows.sort((a,b)=>(a.profit??Infinity)-(b.profit??Infinity)||a.key.localeCompare(b.key)),bills:[...bills.values()],index};
}
