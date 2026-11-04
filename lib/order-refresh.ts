import {supplyProducts} from './product-supply-view';
import type {OrderLine,OrderStock,PhysicalStock,Product} from './model';
import type {DigitFulfillment,ColorAllocation} from './digit-colors';
import type {OrderConflict,OrderReturn} from './order-policy';
import type {PrintJob,PrintEvent} from './printing';
import {enrichPrinting} from './printing-actions';

type Movement={id:string;code:string;kind?:string;unit?:string;type:string;delta:number;note:string;at:number};
type Route={order_key:string;stock_code:string;per_unit:number;quantity:number;allocated_qty:number;color:string};
export type OrderRefresh={keys:string[];shop:string;order_id:string;products:Product[];physical:PhysicalStock[];orders:OrderLine[];orderStocks:OrderStock[];digitFulfillments:DigitFulfillment[];digitOrderRules:Route[];conflicts:OrderConflict[];returns:OrderReturn[];printJobs:PrintJob[];printEvents:PrintEvent[];movements:Movement[]};
type State=Omit<OrderRefresh,'keys'|'shop'|'order_id'|'digitOrderRules'>&{digitOrderRules?:Route[]};
export const ORDER_REFRESH_ACTIONS=new Set(['digit_fulfillment','digit_recheck','digit_print','print_transfer','print_cost','order_review']);

// Return a complete, scoped replacement for this order group, including old
// colour deductions that were restored. The unrelated ERP history stays local.
export async function readOrderRefresh(d:D1Database,scope:string,target:{key?:string;shop?:string;order_id?:string}):Promise<OrderRefresh>{
 const group=typeof target.key==='string'?await d.prepare('SELECT shop,order_id FROM orders WHERE scope=? AND key=?').bind(scope,target.key).first<{shop:string;order_id:string}>():typeof target.shop==='string'&&typeof target.order_id==='string'?{shop:target.shop,order_id:target.order_id}:null;
 if(!group)throw new Error('未找到需要更新的订单');
 const {shop,order_id:id}=group,args=[scope,shop,id],members='SELECT key FROM orders WHERE scope=? AND shop=? AND order_id=?',codes='SELECT code FROM orders WHERE scope=? AND shop=? AND order_id=?';
 const r=await d.batch([
  d.prepare("SELECT o.*,f.refund_amount,f.net_amount,COALESCE((SELECT json_group_array(w.tracking) FROM order_waybills w WHERE w.scope=o.scope AND w.order_key=o.key),'[]') AS tracking_json FROM orders o LEFT JOIN order_finance f ON f.scope=o.scope AND f.order_key=o.key WHERE o.scope=? AND o.shop=? AND o.order_id=? ORDER BY o.order_time DESC").bind(...args),
  d.prepare(`SELECT * FROM products WHERE scope=? AND code IN (${codes})`).bind(scope,...args),
  d.prepare(`SELECT * FROM physical_stocks WHERE scope=? AND code IN (SELECT stock_code FROM order_stocks WHERE scope=? AND order_key IN (${members}) UNION SELECT stock_code FROM stock_rules WHERE scope=? AND sales_code IN (${codes}) UNION SELECT code FROM order_returns WHERE scope=? AND kind='physical' AND order_key IN (${members}))`).bind(scope,scope,...args,scope,...args,scope,...args),
  d.prepare(`SELECT os.order_key,os.sales_code,os.stock_code,os.deducted_qty,COALESCE((SELECT unit FROM physical_stocks WHERE scope=os.scope AND code=os.stock_code),(SELECT unit FROM movements WHERE scope=os.scope AND code=os.stock_code AND reference=os.order_key AND unit!='' LIMIT 1),'张') AS unit FROM order_stocks os WHERE os.scope=? AND os.order_key IN (${members})`).bind(scope,...args),
  d.prepare(`SELECT order_key,status,color,reason,signature,updated_at,fixed_groups FROM digit_fulfillments WHERE scope=? AND order_key IN (${members})`).bind(scope,...args),
  d.prepare("SELECT r.order_key,r.stock_code,1.0*r.per_unit*COALESCE(r.allocated_qty,o.quantity)/o.quantity AS per_unit,r.per_unit*COALESCE(r.allocated_qty,o.quantity) AS quantity,COALESCE(r.allocated_qty,o.quantity) AS allocated_qty,v.color FROM digit_fulfillment_rules r JOIN orders o ON o.scope=r.scope AND o.key=r.order_key JOIN digit_fulfillments f ON f.scope=r.scope AND f.order_key=r.order_key LEFT JOIN digit_stock_variants v ON v.scope=r.scope AND v.stock_code=r.stock_code AND (v.base_code IN (SELECT stock_code FROM stock_rules WHERE scope=r.scope AND sales_code=r.sales_code) OR v.base_code IN (SELECT value FROM json_each(CASE WHEN f.fixed_groups='' THEN '[]' ELSE f.fixed_groups END))) WHERE r.scope=? AND o.shop=? AND o.order_id=? AND f.status IN ('auto','manual')").bind(...args),
  d.prepare(`SELECT * FROM order_conflicts WHERE scope=? AND order_key IN (${members}) ORDER BY created_at DESC`).bind(scope,...args),
  d.prepare(`SELECT order_key,code,kind,quantity,at FROM order_returns WHERE scope=? AND order_key IN (${members})`).bind(scope,...args),
  d.prepare('SELECT * FROM print_jobs WHERE scope=? AND shop=? AND order_id=?').bind(...args),
  d.prepare('SELECT * FROM print_events WHERE scope=? ORDER BY at DESC LIMIT 100').bind(scope),
  d.prepare('SELECT * FROM movements WHERE scope=? ORDER BY at DESC LIMIT 300').bind(scope),
 ]);
 const routes=r[5].results as Route[],allocations=new Map<string,Map<string,ColorAllocation>>();
 for(const route of routes)if(route.color){const colors=allocations.get(route.order_key)??new Map();colors.set(route.color,{color:route.color,quantity:route.allocated_qty});allocations.set(route.order_key,colors);}
 const choices=(r[4].results as DigitFulfillment[]).map(f=>({...f,allocations:[...(allocations.get(f.order_key)?.values()??[])]})),choiceMap=new Map(choices.map(f=>[f.order_key,f])),jobs=r[8].results as PrintJob[];
 const orders=enrichPrinting((r[0].results as (OrderLine&{tracking_json:string})[]).map(raw=>{const {tracking_json,...rest}=raw,f=choiceMap.get(raw.key);return {...rest,tracking_numbers:JSON.parse(tracking_json),...(f?{stock_items:routes.filter(a=>a.order_key===raw.key).map(a=>({stock_code:a.stock_code,per_unit:a.per_unit,quantity:a.quantity})),...(f.status==='print'?{fulfillment_mode:'print' as const,printing_note:f.color}:{})}:{})};}),jobs);
 if(!orders.length)throw new Error('订单已变化，请刷新');
 return {keys:orders.map(o=>o.key),shop,order_id:id,orders,products:await supplyProducts(d,scope,r[1].results as Product[]),physical:r[2].results as PhysicalStock[],orderStocks:r[3].results as OrderStock[],digitFulfillments:choices,digitOrderRules:routes,conflicts:r[6].results as OrderConflict[],returns:r[7].results as OrderReturn[],printJobs:jobs,printEvents:r[9].results as PrintEvent[],movements:r[10].results as Movement[]};
}

function mergeCodes<T extends {code:string}>(current:T[],fresh:T[]):T[]{
 const updates=new Map(fresh.map(r=>[r.code,r]));let changed=false;
 const rows=current.map(r=>{const next=updates.get(r.code);updates.delete(r.code);if(!next||Object.keys(r).length===Object.keys(next).length&&Object.entries(r).every(([k,v])=>Object.is(v,(next as Record<string,unknown>)[k])))return r;changed=true;return next;});
 return changed||updates.size?[...rows,...updates.values()]:current;
}
export function mergeOrderRefresh<T extends State>(current:T,patch:OrderRefresh):T{
 const keys=new Set([...patch.keys,...current.orders.filter(o=>o.shop===patch.shop&&o.order_id===patch.order_id).map(o=>o.key)]);
 return {...current,products:mergeCodes(current.products,patch.products),physical:mergeCodes(current.physical,patch.physical),orders:[...current.orders.filter(o=>!keys.has(o.key)),...patch.orders].sort((a,b)=>b.order_time-a.order_time),orderStocks:[...current.orderStocks.filter(r=>!keys.has(r.order_key)),...patch.orderStocks],digitFulfillments:[...current.digitFulfillments.filter(r=>!keys.has(r.order_key)),...patch.digitFulfillments],digitOrderRules:[...(current.digitOrderRules??[]).filter(r=>!keys.has(r.order_key)),...patch.digitOrderRules],conflicts:[...current.conflicts.filter(r=>!keys.has(r.order_key)),...patch.conflicts],returns:[...current.returns.filter(r=>!keys.has(r.order_key)),...patch.returns],printJobs:[...current.printJobs.filter(j=>j.shop!==patch.shop||j.order_id!==patch.order_id),...patch.printJobs].sort((a,b)=>b.created_at-a.created_at),printEvents:patch.printEvents,movements:patch.movements};
}
