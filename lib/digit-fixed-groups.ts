import {fulfillmentPlan,type DigitVariant,type ColorAllocation} from './digit-colors';
import type {OrderLine,StockRule,PhysicalStock} from './model';
import type {DigitCondition} from './warehouse-digit-conditions';

export function savedFixedGroups(value?:string):string[]{
 try {const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)&&parsed.every(v=>typeof v==='string')?parsed:[];}catch{return [];}
}
export function fixedGroupOptions(code:string,rules:StockRule[],variants:DigitVariant[]){
 const original=rules.filter(r=>r.sales_code===code),bases=new Set(original.map(r=>r.stock_code));
 if(original.some(r=>!variants.some(v=>v.base_code===r.stock_code))||new Set(original.map(r=>r.per_unit)).size!==1)return [];
 const sizes=new Set(variants.filter(v=>bases.has(v.base_code)).map(v=>v.size));
 if(sizes.size!==1)return [];
 return [...new Map(variants.filter(v=>sizes.has(v.size)).map(v=>[v.base_code,{base_code:v.base_code,size:v.size,start:v.start,end:v.end}])).values()].sort((a,b)=>a.start-b.start||a.end-b.end);
}
// Only existing boards of the original diameter can be selected. Retain the
// original SKU's common sheets-per-portion multiplier for every selected board.
export function fixedGroupPlan(o:OrderLine,rules:StockRule[],variants:DigitVariant[],stocks:PhysicalStock[],groups:string[],allocations:ColorAllocation[],conditions?:DigitCondition[]){
 const options=fixedGroupOptions(o.code,rules,variants);
 if(!groups.length||groups.length>200||new Set(groups).size!==groups.length||groups.some(c=>!options.some(v=>v.base_code===c)))throw new Error('请选择本规格已有的固定数字组，不能选择其他尺寸或自定义版面');
 const chosen=options.filter(v=>groups.includes(v.base_code));
 const perUnit=rules.find(r=>r.sales_code===o.code)!.per_unit;
 const selectedRules=chosen.map(v=>({sales_code:o.code,stock_code:v.base_code,per_unit:perUnit}));
 const start=Math.min(...chosen.map(v=>v.start)),end=Math.max(...chosen.map(v=>v.end));
 const plan=fulfillmentPlan({...o,spec:`${chosen[0].size}cm ${start}-${end}`},selectedRules,variants,stocks,allocations,conditions);
 return plan?{...plan,label:`${chosen[0].size}cm · `+chosen.map(v=>`${v.start}～${v.end}`).join('、')}:null;
}
