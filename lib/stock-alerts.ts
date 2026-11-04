import {forecastStock} from './product-report';
import type {Product,PhysicalStock,StockRule,OrderLine,InventoryRow} from './model';
import type {Purchase} from './purchasing';
import {buildAlertDemand,type AlertDemandContext} from './alert-demand';
import {DEFAULT_ALERT_SETTINGS,type AlertSettings} from './stock-alert-policy';
export type AlertReason='negative'|'zero'|'pack'|'minimum'|'forecast';
export const ALERT_REASONS:Record<AlertReason,string>={negative:'负库存待核对',zero:'已缺货',pack:'部分销售规格不足',minimum:'低于数量底线',forecast:'销量预警'};
export type StockAlert=InventoryRow&{stage:'review'|'restock';priority:'review'|'urgent'|'attention'|'normal'|'uncounted';reasons:{kind:AlertReason;text:string}[];usage:number;recent:number;daily:number;accelerating:boolean;largeOrder:boolean;cover:number|null;availableSales:string[];pendingQuantity:number;pendingCount:number;purchaseUnitIssues:number;fixedMinimum:number;forecastMinimum:number;suggested:number;ignored:boolean;ignoreUntil:number|null;ignoreVersion:number};
export type StockAlertSnapshot={partial?:boolean;asOf:number;rows:StockAlert[];ignoredRows:StockAlert[];otherRows:StockAlert[];review:number;restock:number;urgent:number;attention:number;uncounted:number;observedDays:number;predictionNote:string;settings:AlertSettings;reference:{source:string;start:number;end:number;valid:number;matched:number;unresolved:number;printed:number;unresolvedCodes:string[]}};
export const alertKey=(r:Pick<InventoryRow,'kind'|'code'>)=>JSON.stringify([r.kind,r.code]);
export function buildStockAlerts(products:Product[],stocks:PhysicalStock[],rules:StockRule[],orders:OrderLine[],purchases:Purchase[]=[],now=Date.now(),context?:AlertDemandContext):StockAlertSnapshot{
 const settings=context?.settings??{...DEFAULT_ALERT_SETTINGS},demand=buildAlertDemand(products,stocks,rules,orders,context,now),ignores=new Map((context?.ignores??[]).map(r=>[alertKey(r),r]));
 const pending=new Map<string,Purchase[]>();for(const p of purchases){if(p.status!=='pending')continue;const key=alertKey(p),a=pending.get(key)??[];a.push(p);pending.set(key,a);}
 const rows:StockAlert[]=[],ignoredRows:StockAlert[]=[],otherRows:StockAlert[]=[];
 for(const row of forecastStock(products,stocks,rules,[],{now})){
  const t=demand.totals.get(alertKey(row)),usage=t?.usage??0,recent=t?.recent??0,average=demand.days?usage/demand.days:0,shortAverage=demand.shortDays?recent/demand.shortDays:0;
  const accelerating=demand.days>=7&&(t?.activeDays.size??0)>=3&&shortAverage>average*1.25,daily=accelerating?shortAverage:average;
  const fixedMinimum=Math.max(row.unit==='张'?settings.sheetMinimum:row.unit==='贴'?settings.stickerMinimum:0,row.minimum||0),forecastMinimum=Math.ceil(daily*(settings.leadDays+settings.bufferDays)),minimum=Math.max(fixedMinimum,forecastMinimum),q=row.quantity;
  const cover=q==null||!daily?null:Math.max(0,q)/daily,reasons:StockAlert['reasons']=[];
  if(q!=null){if(q<0)reasons.push({kind:'negative',text:'库存为负，请核对盘点和扣减。'});else{
   if(q===0)reasons.push({kind:'zero',text:'当前库存为0。'});
   if(q>0&&row.blocked_codes.length)reasons.push({kind:'pack',text:`有${row.blocked_codes.length}个关联销售规格不足一份。`});
   if(q<fixedMinimum)reasons.push({kind:'minimum',text:`当前${q}${row.unit}，低于数量底线${fixedMinimum}${row.unit}。`});
   if(q<forecastMinimum)reasons.push({kind:'forecast',text:`按日均${daily.toFixed(2)}${row.unit}，${settings.leadDays}天采购＋${settings.bufferDays}天缓冲需${forecastMinimum}${row.unit}。`});
  }}
  const buys=pending.get(alertKey(row))??[],same=buys.filter(p=>p.unit===row.unit),pendingQuantity=same.reduce((n,p)=>n+p.quantity,0),ignore=ignores.get(alertKey(row));
  const ignored=q!==null&&q<0?false:ignore?ignore.until_at===0||ignore.until_at>now:!!row.ignore_warning;
  const priority=q==null?'uncounted':q<0?'review':reasons.some(r=>r.kind==='forecast'||r.kind==='pack')||q===0&&daily>0?'urgent':reasons.length?'attention':'normal';
  const result:StockAlert={...row,minimum,stage:q!=null&&q<0?'review':'restock',priority,reasons,usage,recent,daily,accelerating,largeOrder:usage>0&&(t?.maxOrder??0)>=usage*.5,cover,availableSales:[],pendingQuantity,pendingCount:buys.length,purchaseUnitIssues:buys.length-same.length,fixedMinimum,forecastMinimum,suggested:q==null||q<0?0:Math.max(0,Math.ceil(minimum-q-pendingQuantity)),ignored,ignoreUntil:ignored?(ignore?.until_at??0):null,ignoreVersion:ignore?.updated_at??0};
  if(ignored)ignoredRows.push(result);else if(reasons.length)rows.push(result);else otherRows.push(result);
 }
 const rank={review:0,urgent:1,attention:2,uncounted:3,normal:4};for(const list of [rows,ignoredRows,otherRows])list.sort((a,b)=>rank[a.priority]-rank[b.priority]||(a.cover??Infinity)-(b.cover??Infinity)||a.name.localeCompare(b.name,'zh-CN'));
 const label=(t:number)=>new Date(t+8*3600000).toISOString().slice(0,10),period=demand.days?`${label(demand.start)}至${label(demand.end-1)}，${demand.days}天`:'暂无完整日期范围';
 const predictionNote=`销量参考：${period}；按下单日期统计已发货/已完成的实物需求。${demand.unresolved}条明细未能确定实物，未计入预测。后续ERP覆盖同一订单时以最新记录为准；缺少导入会低估销量。`;
 return {asOf:now,rows,ignoredRows,otherRows,review:rows.filter(r=>r.priority==='review').length,restock:rows.filter(r=>r.stage==='restock').length,urgent:rows.filter(r=>r.priority==='urgent').length,attention:rows.filter(r=>r.priority==='attention').length,uncounted:otherRows.filter(r=>r.quantity==null).length,observedDays:demand.days,predictionNote,settings,reference:{source:demand.source,start:demand.start,end:demand.end,valid:demand.valid,matched:demand.matched,unresolved:demand.unresolved,printed:demand.printed,unresolvedCodes:demand.unresolvedCodes}};
}
export function filterStockAlerts(snapshot:StockAlertSnapshot,query='',filter='all'){
 const q=query.trim().toLowerCase(),list=filter==='counted'?[...snapshot.rows,...snapshot.ignoredRows,...snapshot.otherRows].filter(r=>r.quantity!=null):filter==='normal'?snapshot.otherRows.filter(r=>r.quantity!=null):filter==='ignored'?snapshot.ignoredRows:filter==='uncounted'?snapshot.otherRows.filter(r=>r.quantity==null):filter==='everything'?[...snapshot.rows,...snapshot.ignoredRows,...snapshot.otherRows]:snapshot.rows;
 return list.filter(r=>(['all','counted','normal','ignored','uncounted','everything'].includes(filter)||r.stage===filter||r.priority===filter||r.reasons.some(x=>x.kind===filter))&&(!q||[r.name,r.code,r.spec,r.location,...r.sales_codes,...r.sales_names,...r.reasons.map(x=>x.text)].join(' ').toLowerCase().includes(q)));
}
