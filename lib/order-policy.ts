import {sourceDetails} from './order-sources';
import {isValid,type OrderLine,type Product,type PhysicalStock,type StockRule} from './model';
export function orderFingerprint(o:OrderLine){const fields:unknown[]=[o.status,o.quantity,o.order_time,o.amount??null,o.cost??null,o.shipped_at??null,o.source_updated_at??null,o.shipped_qty??0,o.cutoff_ack_at??null,o.buyer_remark??'',o.seller_remark??''];if(o.source_details)fields.push(o.source_details);return JSON.stringify(fields);}
export function importDecision(old:OrderLine|undefined,next:OrderLine):'apply'|'ignore'|'conflict'{
 if(!old)return 'apply';
 if(old.source_updated_at&&next.source_updated_at&&next.source_updated_at<old.source_updated_at)return 'ignore';
 const newer=!!(old.source_updated_at&&next.source_updated_at&&next.source_updated_at>old.source_updated_at);
 const rank=(s:string)=>s==='已完成'?2:s==='已发货'?1:0;
 const before=sourceDetails(old),after=sourceDetails(next);
 const changed=!!(before&&after&&before.after_sale&&before.after_sale!=='无售后'&&after.after_sale!==before.after_sale)||old.quantity!==next.quantity||old.order_time!==next.order_time||
  (old.amount!=null&&next.amount!=null&&old.amount!==next.amount)||
  (old.cost!=null&&next.cost!=null&&old.cost!==next.cost)||
  (old.shipped_at!=null&&next.shipped_at!=null&&old.shipped_at!==next.shipped_at)||
  (old.status!==next.status&&(['已关闭','已取消'].includes(old.status)||(isValid(old.status)&&(rank(next.status)<rank(old.status)||!isValid(next.status)))));
 return changed&&!newer?'conflict':'apply';
}
export function cutoffTime(o:OrderLine,products:Product[],stocks:PhysicalStock[],rules:StockRule[],ignoreCutoff=false){
 if(ignoreCutoff||o.fulfillment_mode==='print')return null;
 if(o.shipped_at!=null||!(o.shipped_qty||isValid(o.status)))return null;
 const p=products.find(p=>p.code===o.code);if(!p||p.tracking_enabled===0)return null;
 const times=p.stock_mode==='recipe'?(o.stock_items??rules.filter(r=>r.sales_code===p.code)).map(r=>stocks.find(s=>s.code===r.stock_code&&!s.archived)).filter(s=>s?.quantity!=null).map(s=>s!.count_at):p.quantity==null?[]:[p.count_at];
 const pending=times.filter((at):at is number=>at!=null&&at>=o.order_time&&at>(o.cutoff_ack_at??0));
 return pending.length?Math.max(...pending):null;
}
export type OrderConflict={order_key:string;payload:string;reason:string;fingerprint:string;created_at:number};
export type OrderReturn={damaged?:number;order_key:string;code:string;kind:'physical'|'product';quantity:number;at:number};
