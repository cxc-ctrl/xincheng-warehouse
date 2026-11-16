import {shopKey,type SettlementRow} from './shops';
import {scopeProfit,type ReportScope} from './shop-report-filters';
export function sumKnown(rows:SettlementRow[],get:(r:SettlementRow)=>number|null){const values=rows.map(get),known=values.filter((v):v is number=>v!=null);return {amount:known.length?known.reduce((a,b)=>a+b,0):null,missing:values.length-known.length};}
export function shopSummaries(rows:SettlementRow[],scope:ReportScope){
 const groups=new Map<string,SettlementRow[]>();
 for(const r of rows){const key=shopKey(r.base.lines[0].platform,r.base.shop),group=groups.get(key)??[];group.push(r);groups.set(key,group);}
 return [...groups].map(([key,items])=>({key,platform:items[0].base.lines[0].platform,code:items[0].base.shop,name:items.find(r=>r.policy?.name)?.policy?.name||items[0].base.shop,rows:items,
 net:sumKnown(items,r=>r.base.net),goods:sumKnown(items,r=>r.base.goods),packing:sumKnown(items,r=>r.base.packing),freight:sumKnown(items,r=>r.base.freight),settlement:sumKnown(items,r=>r.policy?.kind==='supply'?r.settlement:0),profit:sumKnown(items,r=>scopeProfit(r,scope))})).sort((a,b)=>a.platform.localeCompare(b.platform)||a.code.localeCompare(b.code));
}
