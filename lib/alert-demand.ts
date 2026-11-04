import {isValid,isPrintOnly,type Product,type PhysicalStock,type StockRule,type OrderLine} from './model';
import {fulfillmentPlan,type DigitVariant} from './digit-colors';
import type {DigitCondition} from './warehouse-digit-conditions';
import type {DigitRemarkRule} from './digit-remark-rules';
import {ALERT_DAY,type AlertPolicy} from './stock-alert-policy';
export type AlertDemandContext=AlertPolicy&{variants?:DigitVariant[];conditions?:DigitCondition[];remarkRules?:DigitRemarkRule[]};
const dayStart=(t:number)=>Math.floor((t+8*3600000)/ALERT_DAY)*ALERT_DAY-8*3600000;
export function buildAlertDemand(products:Product[],stocks:PhysicalStock[],rules:StockRule[],live:OrderLine[],context?:AlertDemandContext,now=Date.now()){
 const sample=context?.sample,merged=new Map((sample?.orders??[]).filter(o=>o.order_time>=sample!.start_at&&o.order_time<sample!.end_at).map(o=>[o.key,o]));for(const o of live)merged.set(o.key,o);
 const excluded=new Set(context?.excluded??[]),orders=[...merged.values()].filter(o=>o.order_time<=now&&!excluded.has(JSON.stringify([o.shop,o.order_id])));
 const dates=orders.map(o=>o.order_time).filter(Number.isFinite),first=dates.length?Math.min(...dates):now,last=dates.length?Math.max(...dates):0;
 // Preserve the complete user-supplied window until newer ERP records exist.
 // New windows are explicitly based on imported records, never a claim of full coverage.
 let start=sample?.start_at??dayStart(first),end=sample?.end_at??Math.min(dayStart(last)+ALERT_DAY,dayStart(now));
 let source=sample?.filename??'ERP已导入记录';
 if(last>=end&&last>0){end=Math.min(dayStart(last)+ALERT_DAY,dayStart(now));start=Math.max(dayStart(first),end-15*ALERT_DAY);source='ERP已导入记录（最近15天）';}
 const days=Math.max(0,Math.round((end-start)/ALERT_DAY)),shortDays=Math.min(7,days),shortStart=end-shortDays*ALERT_DAY;
 const pmap=new Map(products.map(p=>[p.code,p])),smap=new Map(stocks.filter(s=>!s.archived).map(s=>[s.code,s]));
 const bySku=new Map<string,StockRule[]>();for(const r of rules){const a=bySku.get(r.sales_code)??[];a.push(r);bySku.set(r.sales_code,a);}
 const variants=context?.variants??[],baseSet=new Set(variants.map(v=>v.base_code));
 // Demand recognition must not depend on today's balance or first count date.
 const recognitionStocks=stocks.map(s=>({...s,quantity:Number.MAX_SAFE_INTEGER}));
 const routeCache=new Map<string,ReturnType<typeof fulfillmentPlan>>();
 const totals=new Map<string,{usage:number;recent:number;activeDays:Set<number>;maxOrder:number}>();
 let valid=0,matched=0,unresolved=0,printed=0;const unresolvedCodes=new Set<string>(),dailyDates=new Set<number>();
 for(const o of orders){
  if(!isValid(o.status)||o.quantity<=0||o.order_time<start||o.order_time>=end)continue;valid++;dailyDates.add(dayStart(o.order_time));
  const p=pmap.get(o.code);if(isPrintOnly(p)||o.fulfillment_mode==='print'||p?.tracking_enabled===0){printed++;continue;}
  if(!p){unresolved++;unresolvedCodes.add(o.code);continue;}
  let parts:{kind:'product'|'physical';code:string;quantity:number}[]=[];
  const rs=bySku.get(o.code)??[];
  if(o.stock_items?.length)parts=o.stock_items.map(r=>({kind:'physical',code:r.stock_code,quantity:r.quantity??o.quantity*r.per_unit}));
  else if(p.stock_mode!=='recipe')parts=[{kind:'product',code:p.code,quantity:o.quantity}];
  else if(rs.some(r=>baseSet.has(r.stock_code))){
   const key=JSON.stringify([o.code,o.spec,o.buyer_remark,o.seller_remark,o.quantity,o.remarks_available]);
   if(!routeCache.has(key))routeCache.set(key,fulfillmentPlan({...o,title:p.name||o.title},rs,variants,recognitionStocks,undefined,context?.conditions,context?.remarkRules));
   const plan=routeCache.get(key);if(plan?.status==='auto')parts=plan.items.map(r=>({kind:'physical',code:r.stock_code,quantity:(r.allocated_qty??o.quantity)*r.per_unit}));
  }else if(o.stock_items===undefined)parts=rs.map(r=>({kind:'physical',code:r.stock_code,quantity:o.quantity*r.per_unit}));
  if(!parts.length||parts.some(r=>!Number.isFinite(r.quantity)||r.quantity<=0||r.kind==='physical'&&!smap.has(r.code))){unresolved++;unresolvedCodes.add(o.code);continue;}
  matched++;const one=new Map<string,number>();for(const r of parts){const key=JSON.stringify([r.kind,r.code]);one.set(key,(one.get(key)??0)+r.quantity);}
  for(const [key,n] of one){const t=totals.get(key)??{usage:0,recent:0,activeDays:new Set<number>(),maxOrder:0};t.usage+=n;if(o.order_time>=shortStart){t.recent+=n;t.activeDays.add(dayStart(o.order_time));}t.maxOrder=Math.max(t.maxOrder,n);totals.set(key,t);}
 }
 return {totals,days,shortDays,start,end,source,valid,matched,unresolved,printed,unresolvedCodes:[...unresolvedCodes],salesDates:dailyDates.size};
}
