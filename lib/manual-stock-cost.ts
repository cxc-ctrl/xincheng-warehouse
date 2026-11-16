import type {OrderLine} from './model';

export function stockCostBasis(o:OrderLine){return JSON.stringify([o.code,o.spec,o.quantity,o.shipped_qty??0,o.buyer_remark??'',o.seller_remark??'']);}
export function manualStockCost(o:OrderLine):number|null|undefined{
 if(o.manual_stock_cost_cents==null)return undefined;
 return o.manual_stock_cost_basis===stockCostBasis(o)?o.manual_stock_cost_cents/100:null;
}
