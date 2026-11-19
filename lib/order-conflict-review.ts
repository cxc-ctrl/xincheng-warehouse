import {isValid,money,number,time,type OrderLine} from './model';
import {sourceDetails} from './order-sources';
import type {OrderConflict} from './order-policy';
export const CONFLICT_FILTERS=[['conflict_after_sale','已发货后关闭 / 取消'],['conflict_shipment','新发货信息待核对'],['conflict_cost','ERP成本待核对'],['conflict_time','发货时间待核对'],['conflict_other','其他导入信息待核对']] as const;
export type ConflictCategory=typeof CONFLICT_FILTERS[number][0];
export type ConflictChange={field:string;before:string;after:string;check:string};
export type ConflictReview={category:ConflictCategory;label:string;instruction:string;changes:ConflictChange[]};
export function describeOrderConflict(order:OrderLine,conflict:OrderConflict):ConflictReview{
 let next:OrderLine;try{next=JSON.parse(conflict.payload);if(!next||typeof next!=='object'||Array.isArray(next))throw Error();}catch{return {category:'conflict_other',label:'导入信息需重新核对',instruction:'原始导入内容不完整，请重新导入ERP原表后核对。',changes:[]};}
 const changes:ConflictChange[]=[];
 const add=(key:keyof OrderLine,field:string,check:string,format:(v:any)=>string=String)=>{if(next[key]!==undefined&&(order[key]??null)!==(next[key]??null))changes.push({field,before:order[key]==null?'未提供':format(order[key]),after:next[key]==null?'未提供':format(next[key]),check});};
 add('status','订单状态','确认ERP当前状态；若已发货后关闭，核对关闭原因、退款及实际退货情况。');
 add('quantity','销售数量','确认实际销售和发货数量；数量减少时另行登记实际退货。',number);
 add('amount','ERP实付金额','核对ERP实付金额及退款结果。',money);
 add('cost','ERP订单成本','确认这笔订单应采用哪笔ERP成本。',money);
 add('shipped_at','发货时间','确认实际发货时间，核对是否已经包含在仓库盘点中。',time);
 add('order_time','下单时间','核对原订单下单时间，确认是否为同一笔订单。',time);
 add('spec','商品规格','核对实际发货的规格、颜色和数量。');
 const before=sourceDetails(order),after=sourceDetails(next);
 if(before&&after&&before.after_sale!==after.after_sale)changes.push({field:'售后状态',before:before.after_sale||'未提供',after:after.after_sale||'未提供',check:'核对平台退款结果和实际退货；收到实物后再登记入库。'});
 let category:ConflictCategory='conflict_other',label='订单信息变化待核对',instruction=changes.map(c=>c.check).filter((v,i,a)=>a.indexOf(v)===i).join(' ');
 if((isValid(order.status)||(order.shipped_qty??0)>0||!!order.shipped_at)&&['已关闭','已取消'].includes(next.status)&&order.status!==next.status){category='conflict_after_sale';label='已发货后'+(next.status==='已取消'?'取消':'关闭');instruction='核对ERP关闭原因和退款结果；确认是否实际收到退货，收到后再登记退货入库。';}
 else if(!isValid(order.status)&&isValid(next.status)){category='conflict_shipment';label=changes.some(c=>c.field==='ERP订单成本')?'发货及ERP成本变化':'新发货信息待核对';instruction='确认是否已实际发货、发货时间和是否已扣库存。'+(changes.some(c=>c.field==='ERP订单成本')?'同时核对这笔订单的ERP成本。':'');}
 else if(changes.length===1&&changes[0].field==='ERP订单成本'){category='conflict_cost';label='ERP成本变化待核对';}
 else if(changes.length===1&&changes[0].field==='发货时间'){category='conflict_time';label='发货时间变化待核对';}
 else if(changes.length===1)label=changes[0].field+'变化待核对';
 return {category,label,instruction:instruction||'核对本次导入与原订单，选择应保留的数据。',changes};
}
