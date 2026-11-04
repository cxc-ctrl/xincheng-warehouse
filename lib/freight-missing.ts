import {isValid,type OrderLine} from './model';
import {monthOf,orderGroup,type FreightBill} from './freight-reconciliation';
export function unmatchedFreightOrders(orders:OrderLine[],bills:FreightBill[],month:string){
 const billSet=new Set(bills.map(b=>b.tracking)),groups=new Map<string,OrderLine[]>();
 for(const o of orders){const k=orderGroup(o),a=groups.get(k)??[];a.push(o);groups.set(k,a);}
 return [...groups].flatMap(([key,lines])=>{const shipped=lines.filter(o=>isValid(o.status)||(o.shipped_qty??0)>0);if(!shipped.length)return [];const at=Math.min(...shipped.map(o=>o.shipped_at??o.order_time));if(monthOf(at)!==month)return [];const tracking=[...new Set(lines.flatMap(o=>o.tracking_numbers??[]))],missing=tracking.filter(t=>!billSet.has(t));if(tracking.length&&!missing.length)return [];return [{key,order_id:lines[0].order_id,shop:lines[0].shop,at,estimatedDate:shipped.some(o=>!o.shipped_at),tracking,missing,carrier:[...new Set(lines.map(o=>o.carrier).filter(Boolean))].join('、'),goods:lines.map(o=>o.title||o.code).join('；'),status:tracking.length?'运单未匹配账单':'订单缺运单号'}];}).sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key));
}
