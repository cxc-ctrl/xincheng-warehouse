import {shopKey,type SettlementRow} from './shops';
export type ReportScope='company'|'own'|'supply';
export type ReportPeriod='month'|'range'|'all';
export function settlementDate(row:SettlementRow){return new Date(Math.min(...row.base.lines.map(o=>o.shipped_at??o.order_time))+8*3600000).toISOString().slice(0,10);}
export function scopeProfit(row:SettlementRow,scope:ReportScope){return scope==='company'?row.base.profit:scope==='own'?row.shopProfit:row.supplierProfit;}
export function filterSettlements(rows:SettlementRow[],filter:{scope:ReportScope;period:ReportPeriod;month:string;start:string;end:string;shop:string;search:string}){
 const {scope,period,month,start,end,shop,search}=filter;
 if(period==='range'&&(!start||!end||start>end)||period==='month'&&!month)return [];
 return rows.filter(r=>{
  if(scope!=='company'&&r.policy?.kind!==scope)return false;
  if(period==='month'&&r.base.month!==month)return false;
  if(period==='range'){const day=settlementDate(r);if(day<start||day>end)return false;}
  return (!shop||shopKey(r.base.lines[0].platform,r.base.shop)===shop)&&(!search||[r.base.order_id,r.base.shop,r.policy?.name,...r.base.tracking,...r.base.lines.flatMap(o=>[o.code,o.title,o.spec])].join(' ').toLowerCase().includes(search.toLowerCase()));
 });
}
