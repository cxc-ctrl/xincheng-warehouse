import type {DigitRemarkRule} from './digit-remark-rules';
import type {OrderLine} from './model';
export type PrintCatalog={code:string;name:string;spec:string;material:string;unit:string;note:string;enabled:number;updated_at:number;per_pack?:number|null;per_sheet?:number|null;sheet_cost?:number|null;sheet_weight_g?:number|null;layout_mode?:'single'|'manual'};
export type PrintJob={cost_source?:"manual"|"rule";accounting_mode?:'whole'|'sku';member_keys?:string;shop:string;order_id:string;note:string;status:'queued'|'producing'|'done'|'cancelled';actual_quantity:number|null;unit:string;cost_cents:number|null;completed_at:number|null;basis:string;needs_review:number;created_at:number;updated_at:number;actual_weight_g?:number|null;estimate_snapshot?:string|null};
export type PrintEvent={id:string;shop:string;order_id:string;action:string;note:string;at:number};
export type PrintPaperSettings={sheet_cost:number|null;sheet_weight_g:number|null;updated_at:number};
export type PrintSizeRule={size_cm:number;per_sheet:number;sheet_cost:number|null;sheet_weight_g:number|null;enabled:number;updated_at:number};
export type NamedPrintRule={id:string;name:string;material:string;per_sheet:number|null;sheet_weight_g:number|null;print_cost:number|null;laminated:number;lamination_cost:number|null;cutting:'none'|'flat'|'die'|'both';flat_cut_cost:number|null;die_cut_cost:number|null;enabled:number;note:string;updated_at:number};
export type PrintRuleLink={code:string;rule_id:string;per_pack_override:number|null;updated_at:number};
export type PrintRuleMatch=PrintRuleLink&{shop:string;order_id:string};
import type {DigitCondition} from './warehouse-digit-conditions';
export type PrintData={digitRemarkRules?:DigitRemarkRule[];digitConditions?:DigitCondition[];printCatalog:PrintCatalog[];printJobs:PrintJob[];printEvents:PrintEvent[];printPaperSettings?:PrintPaperSettings;printSizeRules?:PrintSizeRule[];printRules?:NamedPrintRule[];printRuleLinks?:PrintRuleLink[];printRuleMatches?:PrintRuleMatch[]};
export const EMPTY_PAPER:PrintPaperSettings={sheet_cost:null,sheet_weight_g:null,updated_at:0};
export const PRINT_PAPER={length:32,width:46.4};
export const EMPTY_PRINT:PrintData={printCatalog:[],printJobs:[],printEvents:[],printPaperSettings:EMPTY_PAPER,printSizeRules:[],printRules:[],printRuleLinks:[],printRuleMatches:[]};
export const PRINT_STATUS={queued:'待打印',producing:'生产中',done:'已完成',cancelled:'已取消'} as const;
export const PRINT_ORDER_STATUS={queued:'待发货',done:'已完成',review:'订单需核对'} as const;
// Fulfilment comes from ERP, independently of whether actual cost has been entered.
export function printOrderStatus(lines:OrderLine[]):keyof typeof PRINT_ORDER_STATUS{
 if(!lines.length||lines.some(o=>!['待发货','已付款','已发货','已完成'].includes(o.status)))return 'review';
 return lines.every(o=>o.status==='已发货'||o.status==='已完成')?'done':'queued';
}
export function printCostNeedsReview(job:PrintJob,lines:OrderLine[]){return job.cost_cents!=null&&(!!job.needs_review||job.basis!==printBasis(lines));}
export const printGroup=(o:Pick<OrderLine,'shop'|'order_id'>)=>JSON.stringify([o.shop,o.order_id]);
export function printLineBasis(o:OrderLine){return JSON.stringify([o.key,o.code,o.title,o.spec,o.quantity,o.buyer_remark??'',o.seller_remark??'']);}
export function printBasis(lines:OrderLine[]){return JSON.stringify([...lines].sort((a,b)=>a.key.localeCompare(b.key)).map(printLineBasis));}
/** Legacy jobs cover the whole order; automatic accounting covers explicit SKU lines. */
export function printJobLines(job:PrintJob,lines:OrderLine[]){
 if(job.accounting_mode!=='sku')return lines;
 const keys=new Set<string>(JSON.parse(job.member_keys||'[]'));return lines.filter(o=>keys.has(o.key));
}
export function printTaskGroups(orders:OrderLine[],jobs:PrintJob[]){const byGroup=new Map(jobs.map(j=>[printGroup(j),j])),groups=new Map<string,OrderLine[]>();for(const o of orders){const key=printGroup(o),job=byGroup.get(key);if(!job||!printJobLines(job,[o]).length)continue;const lines=groups.get(key)??[];lines.push(o);groups.set(key,lines);}return groups;}
