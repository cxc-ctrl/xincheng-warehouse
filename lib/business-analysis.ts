import {inventoryLedger,isValid,recipeStock,type InventoryRow,type Product,type PhysicalStock,type StockRule,type OrderLine} from './model';
import {inventoryDemand} from './inventory-demand';

export const DAY=86400000;
export const dayStart=(n:number)=>Math.floor((n+8*3600000)/DAY)*DAY-8*3600000;
export const dayText=(n:number)=>new Date(n+8*3600000).toISOString().slice(0,10);
export function parseDay(s:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return NaN;const n=Date.parse(s+'T00:00:00+08:00');return Number.isFinite(n)&&dayText(n)===s?n:NaN;}
export type HealthPolicy={urgent:number;low:number;normal:number;high:number;stale:number;high_value:number;holiday:string};
export const DEFAULT_POLICY:HealthPolicy={urgent:7,low:15,normal:45,high:90,stale:30,high_value:500,holiday:''};
export type AnalyticsSettings={updated_at:number;minimum_sales:number;coverage_start:string;coverage_end:string;categories:Record<string,HealthPolicy>};
export const DEFAULT_ANALYTICS:AnalyticsSettings={updated_at:0,minimum_sales:5,coverage_start:'',coverage_end:'',categories:{}};
export type ProductLifecycle={code:string;launch:string;series:string;cohort:string;on_sale:boolean;updated_at:number};
export type ReceiptSummary={kind:'product'|'physical';code:string;first_at:number;total:number};
export type AnalyticsData={analyticsSettings:AnalyticsSettings;productLifecycle:ProductLifecycle[];inventoryReceipts:ReceiptSummary[]};
export const emptyLifecycle=(code:string):ProductLifecycle=>({code,launch:'',series:'',cohort:'',on_sale:true,updated_at:0});
export type Period='today'|'yesterday'|'7'|'15'|'30'|'month'|'custom';
export function periodWindow(period:Period,now:number,from='',to=''){
 const today=dayStart(now);
 if(period==='custom')return {start:parseDay(from),end:Math.min(parseDay(to)+DAY,now+1)};
 if(period==='today')return {start:today,end:now+1};
 if(period==='yesterday')return {start:today-DAY,end:today};
 if(period==='month')return {start:parseDay(dayText(now).slice(0,7)+'-01'),end:now+1};
 return {start:now-Number(period)*DAY,end:now+1};
}
export function covered(s:AnalyticsSettings,start:number,end:number){return !!s.coverage_start&&!!s.coverage_end&&parseDay(s.coverage_start)<=start&&parseDay(s.coverage_end)+DAY>=end;}
export function change(current:number,previous:number):{value:number|null;label:string}{
 if(previous>0){const value=(current-previous)/previous;return {value,label:(value>0?'+':'')+(value*100).toFixed(1)+'%'};}
 return {value:null,label:current>0?'新增动销':'—'};
}
export type SalesMeasure={qty:number;orders:number;skus:number};
export function salesMeasure(lines:OrderLine[],start:number,end:number):SalesMeasure{
 const ids=new Set<string>(),skus=new Set<string>();let qty=0;
 for(const o of lines)if(isValid(o.status)&&o.quantity>0&&o.order_time>=start&&o.order_time<end){ids.add(JSON.stringify([o.shop,o.order_id]));skus.add(o.code);qty+=o.quantity;}
 return {qty,orders:ids.size,skus:skus.size};
}
export type SkuAnalysis={product:Product;meta:ProductLifecycle;lines:OrderLine[];today:SalesMeasure;yesterday:SalesMeasure;seven:SalesMeasure;thirty:SalesMeasure;previous7:SalesMeasure;previous30:SalesMeasure;selected:SalesMeasure;change7:ReturnType<typeof change>;change30:ReturnType<typeof change>;last:number|null;idle:number|null;idleExact:boolean;neverSold:boolean;idleBasis:string;stale:boolean;stockValue:number|null;cover:number|null;low:boolean;launch:number|null;life7:number|null;life15:number|null;life30:number|null;cumulative:number;firstReceipt:ReceiptSummary|undefined;stockRows:InventoryRow[]};
export type StockAnalysis=InventoryRow&{usage:number;cover:number|null;value:number|null;health:string;category:string;policy:HealthPolicy;holidayDays:number|null};
export function buildBusinessAnalysis(products:Product[],physical:PhysicalStock[],rules:StockRule[],orders:OrderLine[],extra:AnalyticsData,now:number,window:{start:number;end:number}){
 const settings=extra.analyticsSettings??DEFAULT_ANALYTICS,today=dayStart(now),pmap=new Map(products.map(p=>[p.code,p])),smap=new Map(physical.map(p=>[p.code,p])),mmap=new Map(extra.productLifecycle.map(m=>[m.code,m]));
 const sales=orders.filter(o=>isValid(o.status)&&o.quantity>0&&o.order_time<=now),bySku=new Map<string,OrderLine[]>(),components=new Map<string,StockRule[]>();
 for(const o of sales){const list=bySku.get(o.code)??[];list.push(o);bySku.set(o.code,list);}
 for(const r of rules){const list=components.get(r.sales_code)??[];list.push(r);components.set(r.sales_code,list);}
 const {sales:qty30,physical:demand}=inventoryDemand(products,rules,orders,now-30*DAY,now+1);
 const ledger=inventoryLedger(products,physical,rules),stockRows:StockAnalysis[]=ledger.map(r=>{
  const cats=[...new Set(r.sales_codes.map(c=>pmap.get(c)?.category).filter((c):c is string=>!!c))],category=cats.length>1?'跨品类共用':cats[0]??'未分类',policy=settings.categories[category]??DEFAULT_POLICY;
  const usage=r.kind==='physical'?demand.get(r.code)??0:qty30.get(r.code)??0,cover=r.quantity==null?null:r.quantity<=0?0:usage>0?r.quantity/(usage/30):null,value=r.quantity==null||r.cost==null?null:Math.max(0,r.quantity)*r.cost;
  const holidayDays=policy.holiday?Math.floor((parseDay(policy.holiday)-today)/DAY):null,d=cover==null?null:Math.ceil(cover);
  let health=r.quantity==null?'待盘点':r.quantity<0?'负库存':r.quantity===0?'已缺货':usage===0?(covered(settings,now-30*DAY,now+1)?'30天无销售':'销量待核对'):d!<=policy.urgent?'即将缺货':d!<=policy.low?'库存偏低':d!<=policy.normal?'正常':d!<=policy.high?'库存偏高':'库存积压';
  if(r.quantity!=null&&r.quantity>0&&holidayDays!=null){if(holidayDays<0)health='节后库存';else if(cover!=null&&cover>holidayDays)health='节前可能结余';}
  return {...r,usage,cover,value,health,category,policy,holidayDays};
 });
 const stockMap=new Map(stockRows.map(r=>[r.kind+':'+r.code,r])),receiptMap=new Map(extra.inventoryReceipts.map(r=>[r.kind+':'+r.code,r]));
 const rows:SkuAnalysis[]=products.map(p=>{
  const meta=mmap.get(p.code)??emptyLifecycle(p.code),lines=bySku.get(p.code)??[],links=components.get(p.code)??[],product=recipeStock(p,links,smap),linked=(p.stock_mode==='recipe'?links.map(r=>stockMap.get('physical:'+r.stock_code)):[stockMap.get('product:'+p.code)]).filter((r):r is StockAnalysis=>!!r);
  const seven=salesMeasure(lines,now-7*DAY,now+1),thirty=salesMeasure(lines,now-30*DAY,now+1),previous7=salesMeasure(lines,now-14*DAY,now-7*DAY),previous30=salesMeasure(lines,now-60*DAY,now-30*DAY);
  const last=lines.length?Math.max(...lines.map(o=>o.order_time)):null,launch=meta.launch?parseDay(meta.launch):null,firstReceipt=p.stock_mode==='recipe'?undefined:receiptMap.get('product:'+p.code),anchor=last??launch??firstReceipt?.first_at??null;
  // Only claim idle days supported by a confirmed continuous import window.
  const idleExact=anchor!=null&&covered(settings,anchor,now+1),coverageAnchor=settings.coverage_start?parseDay(settings.coverage_start):null;
  const knownAnchor=anchor!=null&&coverageAnchor!=null&&covered(settings,Math.max(anchor,coverageAnchor),now+1)?Math.max(anchor,coverageAnchor):null;
  const idle=knownAnchor==null?null:Math.max(0,Math.floor((today-dayStart(knownAnchor))/DAY)),policy=settings.categories[p.category]??DEFAULT_POLICY;
  const covers=linked.flatMap(r=>r.cover==null?[]:[r.cover]),cover=product.quantity!=null&&linked.length>0&&covers.length?Math.min(...covers):null;
  const goodsCost=p.stock_mode==='recipe'?(links.length&&links.every(r=>smap.get(r.stock_code)?.cost!=null&&!smap.get(r.stock_code)?.archived)?links.reduce((n,r)=>n+smap.get(r.stock_code)!.cost!*r.per_unit,0):null):p.cost;
  const value=product.quantity==null||goodsCost==null?null:Math.max(0,product.quantity)*goodsCost;
  return {product,meta,lines,today:salesMeasure(lines,today,now+1),yesterday:salesMeasure(lines,today-DAY,today),seven,thirty,previous7,previous30,selected:salesMeasure(lines,window.start,window.end),change7:change(seven.qty,previous7.qty),change30:change(thirty.qty,previous30.qty),last,idle,idleExact,neverSold:last==null,idleBasis:last?'末次有效销售':launch!=null?'上新日期':firstReceipt?'首次记录入库':'缺上新或入库日期',stale:product.quantity!=null&&product.quantity>0&&idle!=null&&idle>=policy.stale,stockValue:value,cover,low:p.tracking_enabled!==0&&product.quantity!=null&&(product.quantity<=p.minimum||(cover!=null&&cover<=policy.urgent)),launch,life7:launch==null?null:salesMeasure(lines,launch,Math.min(launch+7*DAY,now+1)).qty,life15:launch==null?null:salesMeasure(lines,launch,Math.min(launch+15*DAY,now+1)).qty,life30:launch==null?null:salesMeasure(lines,launch,Math.min(launch+30*DAY,now+1)).qty,cumulative:salesMeasure(lines,launch??0,now+1).qty,firstReceipt,stockRows:linked};
 });
 const rmap=new Map(rows.map(r=>[r.product.code,r])),staleStocks=stockRows.filter(r=>r.quantity!=null&&r.quantity>0&&r.sales_codes.length>0&&r.sales_codes.every(c=>rmap.get(c)?.stale));
 const onsite=rows.filter(r=>r.meta.on_sale),activation=(days:7|30)=>onsite.length?onsite.filter(r=>(days===7?r.seven:r.thirty).qty>0).length/onsite.length:null;
 return {rows,stockRows,staleStocks,sales,settings,activation7:activation(7),activation30:activation(30),onsite:onsite.length,today:salesMeasure(sales,today,now+1),yesterdaySame:salesMeasure(sales,today-DAY,now-DAY+1),unknownCodes:new Set(sales.filter(o=>!pmap.has(o.code)).map(o=>o.code)).size};
}
export function dailySeries(lines:OrderLine[],now:number,days=30){const start=dayStart(now)-(days-1)*DAY;return Array.from({length:days},(_,i)=>{const at=start+i*DAY;return {date:dayText(at),...salesMeasure(lines,at,Math.min(at+DAY,now+1))};});}
export function idleBucket(days:number|null){if(days==null)return '资料待补';return days<7?'0–6天':days<15?'7–14天':days<30?'15–29天':days<60?'30–59天':days<90?'60–89天':'90天以上';}
