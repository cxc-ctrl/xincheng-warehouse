import type {OrderLine,Product,PhysicalStock,StockRule} from './model';
import type {OrderReturn} from './order-policy';
export function returnPlan(order:OrderLine,products:Product[],stocks:PhysicalStock[],rules:StockRule[],returns:OrderReturn[]){
 if(order.fulfillment_mode==='print')return [];
 const p=products.find(p=>p.code===order.code),shipped=order.shipped_qty??0;
 if(!p||!shipped)return [];
 const items=p.stock_mode==='recipe'?(order.stock_items??rules.filter(r=>r.sales_code===order.code)).map(r=>({kind:'physical' as const,code:r.stock_code,name:stocks.find(s=>s.code===r.stock_code)?.name??r.stock_code,unit:stocks.find(s=>s.code===r.stock_code)?.unit??'张',perSet:('quantity' in r&&r.quantity!=null?r.quantity:shipped*r.per_unit)/shipped,max:('quantity' in r&&r.quantity!=null?r.quantity:shipped*r.per_unit)})):[{kind:'product' as const,code:p.code,name:p.name,unit:p.unit,perSet:1,max:shipped}];
 return items.map(i=>({...i,max:Math.max(0,i.max-returns.filter(r=>r.order_key===order.key&&r.kind===i.kind&&r.code===i.code).reduce((n,r)=>n+r.quantity+(r.damaged??0),0))}));
}
