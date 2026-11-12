import {digitSignature,fulfillmentPlan,type DigitFulfillment,type DigitVariant} from './digit-colors';
import {isValid,isPrintOnly,type OrderLine,type PhysicalStock,type StockRule,type Product} from './model';
import {readDigitConditions,type DigitCondition} from './warehouse-digit-conditions';
import {readRemarkRules} from './digit-remark-actions';
import type {DigitRemarkRule} from './digit-remark-rules';
type RecognitionCache={plans:Map<string,ReturnType<typeof fulfillmentPlan>>;stocks:Map<string,PhysicalStock>;virtual:PhysicalStock[]};
export function historicalCounted(o:OrderLine,f:Pick<DigitFulfillment,'status'|'reason'|'signature'|'fixed_groups'>,p:Product|undefined,rules:StockRule[],stocks:PhysicalStock[],variants:DigitVariant[],conditions:DigitCondition[],remarks:DigitRemarkRule[],cache?:RecognitionCache){
 if(f.status!=='pending'||!/未盘点|库存尚未确认/.test(f.reason)||f.fixed_groups||f.signature!==digitSignature(o)||!isValid(o.status)||o.review||!o.shipped_at||(o.shipped_qty??0)!==o.quantity||!p||isPrintOnly(p))return false;
 // Route recognition only: a later physical count already includes these
 // shipments. Current balance must never cause a historical second deduction.
 const key=JSON.stringify([o.code,p.name,digitSignature(o)]);
 const plan=cache?.plans.has(key)?cache.plans.get(key):fulfillmentPlan({...o,title:p.name},rules,variants,cache?.virtual??stocks.map(s=>({...s,quantity:s.quantity==null?null:Number.MAX_SAFE_INTEGER})),undefined,conditions,remarks);
 if(cache&&!cache.plans.has(key))cache.plans.set(key,plan??null);
 if(!plan||plan.status!=='auto'||!plan.items.length)return false;
 const map=cache?.stocks??new Map(stocks.map(s=>[s.code,s]));return plan.items.every(r=>{const s=map.get(r.stock_code);return s&&!s.archived&&s.quantity!=null&&s.count_at!=null&&o.shipped_at!<=s.count_at});
}
/** Derived read-only disposition. No choices, routes, costs or quantities change. */
export async function readHistoricalCountedKeys(d:D1Database,scope:string){
 const rows=(await d.prepare(`SELECT o.*,f.status f_status,f.reason f_reason,f.signature f_signature,f.fixed_groups f_groups FROM orders o JOIN digit_fulfillments f ON f.scope=o.scope AND f.order_key=o.key WHERE o.scope=? AND f.status='pending' AND (f.reason LIKE '%未盘点%' OR f.reason LIKE '%库存尚未确认%') AND o.status IN('已发货','已完成') AND o.review=0 AND o.shipped_at IS NOT NULL AND o.shipped_qty=o.quantity AND o.deducted_qty=0 AND NOT EXISTS(SELECT 1 FROM order_conflicts x WHERE x.scope=o.scope AND x.order_key=o.key) AND NOT EXISTS(SELECT 1 FROM order_returns x WHERE x.scope=o.scope AND x.order_key=o.key) AND NOT EXISTS(SELECT 1 FROM order_stocks x WHERE x.scope=o.scope AND x.order_key=o.key AND x.deducted_qty>0) AND NOT EXISTS(SELECT 1 FROM import_conflict_groups x WHERE x.scope=o.scope AND x.order_key=o.key AND x.status='pending') AND NOT EXISTS(SELECT 1 FROM product_supply_profiles p WHERE p.scope=o.scope AND p.code=o.code AND json_extract(p.config,'$.variant.supply_mode') IN('打印定制','定制订单')) AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=o.scope AND j.shop=o.shop AND j.order_id=o.order_id AND (COALESCE(j.accounting_mode,'whole')!='sku' OR EXISTS(SELECT 1 FROM json_each(j.member_keys) WHERE value=o.key)))`).bind(scope).all<OrderLine&{f_status:DigitFulfillment['status'];f_reason:string;f_signature:string;f_groups:string}>()).results;
 const result=new Set<string>();if(!rows.length)return result;
 const c=await d.batch([d.prepare('SELECT * FROM products WHERE scope=?').bind(scope),d.prepare('SELECT * FROM physical_stocks WHERE scope=?').bind(scope),d.prepare('SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=?').bind(scope),d.prepare('SELECT base_code,color,stock_code,size,start,end,available_end FROM digit_stock_variants WHERE scope=?').bind(scope)]);
 const pm=new Map((c[0].results as Product[]).map(p=>[p.code,p])),bySku=new Map<string,StockRule[]>();for(const r of c[2].results as StockRule[]){const a=bySku.get(r.sales_code)??[];a.push(r);bySku.set(r.sales_code,a)}
 const conditions=await readDigitConditions(d,scope),remarks=await readRemarkRules(d,scope);
 const stocks=c[1].results as PhysicalStock[],cache:RecognitionCache={plans:new Map(),stocks:new Map(stocks.map(s=>[s.code,s])),virtual:stocks.map(s=>({...s,quantity:s.quantity==null?null:Number.MAX_SAFE_INTEGER}))};
 for(const o of rows)if(historicalCounted(o,{status:o.f_status,reason:o.f_reason,signature:o.f_signature,fixed_groups:o.f_groups},pm.get(o.code),bySku.get(o.code)??[],stocks,c[3].results as DigitVariant[],conditions,remarks,cache))result.add(o.key);
 return result;
}
