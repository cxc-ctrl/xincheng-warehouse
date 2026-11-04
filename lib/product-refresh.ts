import {supplyProducts} from './product-supply-view';
import type {OrderLine,OrderStock,PhysicalStock,Product} from './model';

type Movement={id:string;code:string;kind?:string;unit?:string;type:string;delta:number;note:string;at:number};
export type ProductRefresh={product:Product;orders:OrderLine[];physical:PhysicalStock[];orderStocks:OrderStock[];movements:Movement[]};
type WarehouseState={products:Product[];orders:OrderLine[];physical:PhysicalStock[];orderStocks:OrderStock[];movements:Movement[]};

// A product edit can backfill costs or recount its orders. Include its related
// stock balances and deductions, without downloading unrelated order history.
export async function readProductRefresh(d:D1Database,scope:string,code:string):Promise<ProductRefresh>{
 const result=await d.batch([
  d.prepare('SELECT * FROM products WHERE scope=? AND code=?').bind(scope,code),
  d.prepare("SELECT o.*,f.refund_amount,f.net_amount,COALESCE((SELECT json_group_array(w.tracking) FROM order_waybills w WHERE w.scope=o.scope AND w.order_key=o.key),'[]') AS tracking_json FROM orders o LEFT JOIN order_finance f ON f.scope=o.scope AND f.order_key=o.key WHERE o.scope=? AND o.code=? ORDER BY o.order_time DESC").bind(scope,code),
  d.prepare('SELECT * FROM physical_stocks WHERE scope=? AND code IN (SELECT stock_code FROM stock_rules WHERE scope=? AND sales_code=?)').bind(scope,scope,code),
  d.prepare(`SELECT os.order_key,os.sales_code,os.stock_code,os.deducted_qty,COALESCE((SELECT unit FROM physical_stocks WHERE scope=os.scope AND code=os.stock_code),(SELECT unit FROM movements WHERE scope=os.scope AND code=os.stock_code AND reference=os.order_key AND unit!='' LIMIT 1),'张') AS unit FROM order_stocks os WHERE os.scope=? AND os.sales_code=?`).bind(scope,code),
  d.prepare('SELECT * FROM movements WHERE scope=? ORDER BY at DESC LIMIT 300').bind(scope),
 ]);
 const product=result[0].results[0] as Product|undefined;
 if(!product)throw new Error('商品保存后未找到，请刷新核对');
 return {product:(await supplyProducts(d,scope,[product]))[0],orders:(result[1].results as (OrderLine&{tracking_json:string})[]).map(raw=>{const {tracking_json,...rest}=raw;return {...rest,tracking_numbers:JSON.parse(tracking_json)};}),physical:result[2].results as PhysicalStock[],orderStocks:result[3].results as OrderStock[],movements:result[4].results as Movement[]};
}

export function mergeProductRefresh<T extends WarehouseState>(current:T,patch:ProductRefresh):T{
 const priorOrders=new Map(current.orders.map(o=>[o.key,o]));
 const code=patch.product.code,stocks=new Map(patch.physical.map(s=>[s.code,s]));
 const products=current.products.some(p=>p.code===code)?current.products.map(p=>p.code===code?patch.product:p):[...current.products,patch.product];
 const physical=current.physical.map(s=>{const fresh=stocks.get(s.code);stocks.delete(s.code);return fresh??s;});
 return {...current,products,physical:[...physical,...stocks.values()],
  orders:[...current.orders.filter(o=>o.code!==code),...patch.orders.map(o=>({...priorOrders.get(o.key),...o}))].sort((a,b)=>b.order_time-a.order_time),
  orderStocks:[...current.orderStocks.filter(o=>o.sales_code!==code),...patch.orderStocks],movements:patch.movements};
}
