import {isValid,type OrderLine} from './model';
import type {DigitIssue} from './order-issues';
export const MAIN_ORDER_FILTERS=[['all','全部订单'],['print','已安排打印'],['shortage','缺货'],['missing','未建立对应库存'],['unknown','备注无法识别'],['spec','规格 / 数量需核对']] as const;
export const EXTRA_ORDER_FILTERS=[['unmatched','未匹配商品'],['count','待盘点'],['audit','已扣记录待复核'],['suggest','建议整单打印'],['other','其他待核对'],['pending','全部待核对'],['valid','有效订单']] as const;
export type OrderFilter=typeof MAIN_ORDER_FILTERS[number][0]|typeof EXTRA_ORDER_FILTERS[number][0];
export const DEFAULT_ORDER_FILTERS:OrderFilter[]=['pending'];
const issueFilter:Record<DigitIssue['label'],OrderFilter>={'缺货':'shortage','未建对应库存':'missing','备注无法识别':'unknown','规格 / 数量需核对':'spec','待盘点':'count','已扣记录待复核':'audit','建议整单打印':'suggest'};
export function toggleOrderFilter(selected:OrderFilter[],key:OrderFilter):OrderFilter[]{
 if(key==='all')return selected.includes('all')?[]:['all'];
 const next=selected.filter(x=>x!=='all');return next.includes(key)?next.filter(x=>x!==key):[...next,key];
}
export function isUnmatchedOrder(order:Pick<OrderLine,'status'|'code'>,known:ReadonlyMap<string,unknown>){return isValid(order.status)&&!known.has(order.code);}
export function indexOrderFilters(orders:OrderLine[],choices:Map<string,{status:string}>,issues:Map<string,DigitIssue>,known:ReadonlyMap<string,unknown>,reviews:Set<string>){
 const seen=new Set<string>(),rows:{order:OrderLine;filters:Set<OrderFilter>}[]=[];
 const counts=Object.fromEntries([...MAIN_ORDER_FILTERS,...EXTRA_ORDER_FILTERS].map(([id])=>[id,0])) as Record<OrderFilter,number>;
 for(const order of orders){if(seen.has(order.key))continue;seen.add(order.key);const filters=new Set<OrderFilter>(['all']);
  if(isValid(order.status))filters.add('valid');
  if(choices.get(order.key)?.status==='print')filters.add('print');
  const issue=issues.get(order.key);if(issue)filters.add(issueFilter[issue.label]);
  if(isUnmatchedOrder(order,known))filters.add('unmatched');
  if(reviews.has(order.key)){filters.add('pending');if(!issue&&!filters.has('unmatched'))filters.add('other');}
  for(const id of filters)counts[id]++;rows.push({order,filters});
 }
 return {rows,counts};
}
export function filterReviewOrders(rows:ReturnType<typeof indexOrderFilters>['rows'],selected:OrderFilter[],search:string){
 const q=search.trim().toLowerCase();return rows.filter(r=>selected.some(id=>r.filters.has(id))&&(!q||[r.order.code,r.order.title,r.order.spec,r.order.order_id,r.order.shop,r.order.buyer_remark,r.order.seller_remark].join(' ').toLowerCase().includes(q))).map(r=>r.order);
}
