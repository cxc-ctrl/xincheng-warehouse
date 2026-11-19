import {sourceDetails} from './order-sources';
import type {OrderLine} from './model';
const unpaid=new Set(['未付款','待付款','待支付']);
export function withoutOrderExecution(o:OrderLine){return !(o.shipped_at||(o.shipped_qty??0)>0||(o.deducted_qty??0)>0||o.fulfillment_mode==='print'||o.unit_cost_snapshot!=null||o.manual_stock_cost_cents!=null||sourceDetails(o)?.shipment_confirmed);}
export function isUnpaidWithoutExecution(o:OrderLine){return unpaid.has(o.status)&&withoutOrderExecution(o);}
export function unpaidImportKind(old:OrderLine|undefined,next:OrderLine,history:boolean):'skip'|'cancel'|null{
 if(history||old&&!withoutOrderExecution(old))return null;
 if(isUnpaidWithoutExecution(next)&&(!old||isUnpaidWithoutExecution(old)||['已取消','已关闭'].includes(old.status)))return 'skip';
 if(old&&isUnpaidWithoutExecution(old)&&['已取消','已关闭'].includes(next.status)&&withoutOrderExecution(next)&&old.quantity===next.quantity&&old.order_time===next.order_time&&old.platform===next.platform)return 'cancel';
 return null;
}
// A zero current balance does not prove that no stock, return or printing action occurred.
export const unpaidHistorySQL=`EXISTS(SELECT 1 FROM order_stocks WHERE scope=? AND order_key=?) OR EXISTS(SELECT 1 FROM order_returns WHERE scope=? AND order_key=?) OR EXISTS(SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=?) OR EXISTS(SELECT 1 FROM digit_fulfillments WHERE scope=? AND order_key=? AND status='print')`;
export function unpaidHistoryArgs(scope:string,o:OrderLine){return [scope,o.key,scope,o.key,scope,o.shop,o.order_id,scope,o.key] as const;}
