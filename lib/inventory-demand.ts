import {isValid,isPrintOnly,type OrderLine,type Product,type StockRule} from './model';

// Consumption follows the actual shipment route when supplied. An explicitly
// empty route means no physical consumption, not a fallback to the SKU default.
// Sales dashboards retain their order-date totals; stock coverage uses ship date.
export function inventoryDemand(products:Product[],rules:StockRule[],orders:OrderLine[],start:number,end:number){
 const sales=new Map<string,number>(),physical=new Map<string,number>(),pmap=new Map(products.map(p=>[p.code,p]));
 for(const o of orders){
  const p=pmap.get(o.code),at=o.shipped_at??o.order_time;
  if(isPrintOnly(p)||p?.tracking_enabled===0||o.fulfillment_mode==='print'||!isValid(o.status)||o.quantity<=0||at<start||at>=end)continue;
  if(o.stock_items){
   for(const r of o.stock_items){const quantity=r.quantity??o.quantity*r.per_unit;if(quantity>0&&Number.isFinite(quantity))physical.set(r.stock_code,(physical.get(r.stock_code)??0)+quantity);}
  }else sales.set(o.code,(sales.get(o.code)??0)+o.quantity);
 }
 for(const r of rules){const p=pmap.get(r.sales_code);if(p?.stock_mode==='recipe'&&!isPrintOnly(p)&&p.tracking_enabled!==0)physical.set(r.stock_code,(physical.get(r.stock_code)??0)+(sales.get(r.sales_code)??0)*r.per_unit);}
 return {sales,physical};
}
