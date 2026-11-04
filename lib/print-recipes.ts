import {EMPTY_PAPER,printBasis,type PrintCatalog,type PrintPaperSettings,type PrintSizeRule} from './printing';
import type {OrderLine} from './model';
import {printRange} from './print-size-rules';

export function printNumber(value:unknown,label:string,integer=false):number|null {
 if(value==null||value==='')return null;
 if(typeof value!=='string'&&typeof value!=='number')throw new Error(label+'格式不正确');
 const s=String(value).trim();if(!s)return null;
 if(!/^\d+(\.\d{1,4})?$/.test(s))throw new Error(label+'请填写非负数字，最多4位小数');
 const n=Number(s);if(!Number.isFinite(n)||n>1e8||integer&&(!Number.isSafeInteger(n)||n<=0))throw new Error(label+(integer?'须为正整数':'超出允许范围'));
 return n;
}
export function printRule(raw:Record<string,unknown>,old?:Partial<PrintCatalog>){
 const value=(key:keyof PrintCatalog)=>Object.prototype.hasOwnProperty.call(raw,key)?raw[key]:old?.[key];
 const mode=value('layout_mode')??'single';if(mode!=='single'&&mode!=='manual')throw new Error('请选择单版计算或人工核定版面');
 const weight=printNumber(value('sheet_weight_g'),'每张重量');if(weight===0)throw new Error('每张重量须大于0，未知请留空');
 return {per_pack:printNumber(value('per_pack'),'每份个数',true),per_sheet:printNumber(value('per_sheet'),'每张可印个数',true),sheet_cost:printNumber(value('sheet_cost'),'每张打印成本'),sheet_weight_g:weight,layout_mode:mode as 'single'|'manual'};
}
export type PrintEstimateRow={code:string;name:string;quantity:number;pieces:number|null;sheets:number|null;cost_cents:number|null;weight_g:number|null;issues:string[];formula?:string;size_cm?:number;rule_name?:string;printing_cents?:number|null;lamination_cents?:number|null;cutting_cents?:number|null};
export type PrintEstimate={rows:PrintEstimateRow[];sheets:number|null;cost_cents:number|null;weight_g:number|null;issues:string[];basis:string;rule_sizes:number[]};
// Round each SKU separately within this order. Different orders and different
// artwork never share a sheet implicitly. Multi-artwork products stay manual.
export function estimatePrinting(lines:OrderLine[],catalog:PrintCatalog[],paper:PrintPaperSettings=EMPTY_PAPER,sizeRules:PrintSizeRule[]=[]):PrintEstimate {
 const rules=new Map(catalog.map(c=>[c.code,c])),sizes=new Map(sizeRules.map(r=>[r.size_cm,r])),usedSizes=new Set<number>(),grouped=new Map<string,{code:string;name:string;quantity:number;line:OrderLine;range:ReturnType<typeof printRange>}>();
 for(const o of lines){const c=rules.get(o.code),specific=c&&(!c.enabled||c.layout_mode==='manual'||!!c.per_pack&&!!c.per_sheet),range=specific?null:printRange(o),key=specific?o.code:JSON.stringify([o.code,o.spec,range]);const old=grouped.get(key);grouped.set(key,{code:o.code,name:o.title||o.code,quantity:(old?.quantity??0)+o.quantity,line:o,range});}
 const rows=[...grouped.values()].map((o):PrintEstimateRow=>{
  const code=o.code,c=rules.get(code),issues:string[]=[],range=o.range,common=range?sizes.get(range.size):undefined;
  let pieces:number|null=null,sheets:number|null=null,cost:number|null=null,weight:number|null=null,formula:string|undefined;
  let rate:number|null|undefined,w:number|null|undefined;
  if(c&&!c.enabled)issues.push('此SKU的打印规则已停用');
  else if(c?.layout_mode==='manual')issues.push('特殊SKU须人工核定张数');
  else if(c?.per_pack&&c.per_sheet){
   if(!Number.isSafeInteger(o.quantity)||o.quantity<=0||!Number.isSafeInteger(o.quantity*c.per_pack))issues.push('订单数量需核对');
   else{pieces=o.quantity*c.per_pack;sheets=Math.ceil(pieces/c.per_sheet);formula='特殊SKU规则：'+pieces+'个 ÷ 每张'+c.per_sheet+'个，向上取整';rate=c.sheet_cost??paper.sheet_cost;w=c.sheet_weight_g??paper.sheet_weight_g;}
  }else if(!range)issues.push('未识别到明确的尺寸和数字范围，请配置特殊SKU规则');
  else if(range.issue)issues.push(range.issue);
  else{
   usedSizes.add(range.size);
   if(!common?.enabled)issues.push(range.size+'cm通用打印规则待配置或已停用');
   else if(!Number.isSafeInteger(o.quantity)||o.quantity<=0||!Number.isSafeInteger(range.pieces*o.quantity)||range.pieces*o.quantity>1e8)issues.push('订单数量需核对');
   else{pieces=range.pieces*o.quantity;sheets=Math.ceil(range.pieces/common.per_sheet)*o.quantity;formula=range.size+'cm：'+range.start+'～'+range.end+'，每号'+range.repeat+'个；每份'+range.pieces+'个 ÷ 每张'+common.per_sheet+'个，向上取整 × '+o.quantity+'份';rate=common.sheet_cost??paper.sheet_cost;w=common.sheet_weight_g??paper.sheet_weight_g;}
  }
  if(sheets!=null){
   const units=rate==null?null:sheets*Math.round(rate*10000);
   if(units==null)issues.push('每张打印成本待配置');else if(!Number.isSafeInteger(units)||units>Number.MAX_SAFE_INTEGER-50)issues.push('预计成本超出范围');else cost=Math.floor((units+50)/100);
   if(w==null||w<=0)issues.push('每张重量待配置');else weight=Math.round(sheets*w*10000)/10000;
  }
  return {code,name:o.name,quantity:o.quantity,pieces,sheets,cost_cents:cost,weight_g:weight,issues,formula,...(range?{size_cm:range.size}:{})};
 });
 const total=(key:'sheets'|'cost_cents'|'weight_g')=>!rows.length||rows.some(r=>r[key]==null)?null:Math.round(rows.reduce((n,r)=>n+r[key]!,0)*10000)/10000;
 const issues=rows.flatMap(r=>r.issues.map(i=>r.code+'：'+i));
 const rule_sizes=[...usedSizes].sort((a,b)=>a-b);
 return {rows,sheets:total('sheets'),cost_cents:total('cost_cents'),weight_g:total('weight_g'),issues,rule_sizes,basis:JSON.stringify([printBasis(lines),paper,[...new Set(lines.map(o=>o.code))].sort().map(k=>rules.get(k)??{code:k}),rule_sizes.map(size=>sizes.get(size)??{size_cm:size})])};
}
