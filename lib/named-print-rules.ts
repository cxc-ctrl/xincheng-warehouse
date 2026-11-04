import {packQuantity,type OrderLine,type Product} from './model';
import {printBasis,type NamedPrintRule,type PrintData} from './printing';
import {printRange} from './print-size-rules';
import type {PrintEstimate,PrintEstimateRow} from './print-recipes';

// Unused generated versions are not editable drafts. Keep the raw records for
// historical estimates, but do not present them as missing configuration.
export function visiblePrintRules(data:PrintData){
 const used=new Set([...(data.printRuleLinks??[]).map(l=>l.rule_id),...(data.printRuleMatches??[]).map(m=>m.rule_id),...(data.digitConditions??[]).map(c=>c.print_rule_id)]);
 return (data.printRules??[]).filter(r=>!/^pc:AUTO-SHEET-[A-F0-9]{20}$/.test(r.id)||used.has(r.id));
}

export type MatchedPrintRow=PrintEstimateRow&{rule_id?:string;rule_name?:string;per_pack:number|null;match_source:'sku'|'order'|'missing';printing_cents:number|null;lamination_cents:number|null;cutting_cents:number|null};
export type MatchedPrintEstimate=Omit<PrintEstimate,'rows'>&{rows:MatchedPrintRow[]};
// Restrict each calculation to this order's indexed inputs. Preserve array
// order so the calculation and concurrency fingerprint remain byte-identical.
export function createLinkedPrintEstimator(products:Product[],data:PrintData){
 const pm=new Map(products.map(p=>[p.code,p]));
 const links=new Map<string,NonNullable<PrintData['printRuleLinks']>>(),matches=new Map<string,NonNullable<PrintData['printRuleMatches']>>();
 for(const l of data.printRuleLinks??[]){const a=links.get(l.code)??[];a.push(l);links.set(l.code,a);}
 for(const m of data.printRuleMatches??[]){const k=JSON.stringify([m.shop,m.order_id]),a=matches.get(k)??[];a.push(m);matches.set(k,a);}
 const rulePositions=new Map((data.printRules??[]).map((r,i)=>[r.id,{r,i}]));
 const linkPositions=new Map((data.printRuleLinks??[]).map((r,i)=>[r,i]));
 return (lines:OrderLine[])=>{
  const codes=new Set(lines.map(o=>o.code)),ls=[...codes].flatMap(c=>links.get(c)??[]).sort((a,b)=>linkPositions.get(a)!-linkPositions.get(b)!);
  const keys=new Set(lines.map(o=>JSON.stringify([o.shop,o.order_id]))),ms=[...keys].flatMap(k=>matches.get(k)??[]).filter(m=>codes.has(m.code));
  const ids=new Set([...ls,...ms].map(l=>l.rule_id)),rs=[...ids].flatMap(id=>rulePositions.has(id)?[rulePositions.get(id)!]:[]).sort((a,b)=>a.i-b.i).map(x=>x.r);
  return estimateLinkedPrinting(lines,[...codes].flatMap(c=>pm.has(c)?[pm.get(c)!]:[]),{...data,printRules:rs,printRuleLinks:ls,printRuleMatches:ms});
 };
}
export function linkedRule(line:OrderLine,data:PrintData){const manual=data.printRuleMatches?.find(m=>m.shop===line.shop&&m.order_id===line.order_id&&m.code===line.code),link=data.printRuleLinks?.find(l=>l.code===line.code),match=manual??link;return {match,rule:data.printRules?.find(r=>r.id===match?.rule_id),source:manual?'order' as const:link?'sku' as const:'missing' as const};}
export function piecesPerPack(line:OrderLine,product?:Product,override?:number|null){
 if(product?.source_product&&product.supply_mode==='打印定制')return packQuantity(product);
 if(override!=null)return override;
 const spec=line.spec.normalize('NFKC').replace(/\s+/g,'');
 const explicitRange=[...spec.matchAll(/(?<![\d.])\d+[-~～至到—–]\d+(?![\d.])/g)].some(m=>!/^(?:cm|厘米|公分)/i.test(spec.slice(m.index!+m[0].length)));
 const range=explicitRange?printRange(line):null;if(range)return range.issue?null:range.pieces;
 const fromProduct=product?packQuantity(product):null;if(fromProduct!=null)return fromProduct;
 if(/数字|号码|编号/.test(line.title)){const titleRange=printRange(line);if(titleRange)return titleRange.issue?null:titleRange.pieces;}
 const counts=[...line.spec.normalize('NFKC').matchAll(/(?:共)?(\d+)\s*(?:贴|枚|张|个|件)/g)].map(m=>Number(m[1]));const unique=[...new Set(counts)];return unique.length===1&&Number.isSafeInteger(unique[0])&&unique[0]>0?unique[0]:null;
}
// 'both' marks the direct-price editor. Legacy modes keep their saved estimate semantics until edited.
export function sheetPrice(rule:NamedPrintRule){return {printing:rule.print_cost,lamination:rule.laminated?rule.lamination_cost:0,cutting:rule.cutting==='both'?(rule.flat_cut_cost==null||rule.die_cut_cost==null?null:rule.flat_cut_cost+rule.die_cut_cost):rule.cutting==='flat'?rule.flat_cut_cost:rule.cutting==='die'?rule.die_cut_cost:0};}
function priced(sheets:number,rate:number|null){if(rate==null)return null;const units=sheets*Math.round(rate*10000);return Number.isSafeInteger(units)&&units<=Number.MAX_SAFE_INTEGER-50?Math.floor((units+50)/100):null;}
function priceParts(sheets:number,rates:{printing:number|null;lamination:number|null;cutting:number|null}){
 const values=[rates.printing,rates.lamination,rates.cutting],units=values.map(v=>v==null?null:sheets*Math.round(v*10000));
 if(units.some(v=>v==null||!Number.isSafeInteger(v)))return values.map(v=>priced(sheets,v));
 const u=units as number[],sum=u.reduce((n,v)=>n+v,0);if(!Number.isSafeInteger(sum)||sum>Number.MAX_SAFE_INTEGER-50)return [null,null,null];
 const cents=u.map(v=>Math.floor(v/100)),total=Math.floor((sum+50)/100),rank=u.map((v,i)=>({i,remainder:v%100})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 for(let n=total-cents.reduce((a,b)=>a+b,0),i=0;i<n;i++)cents[rank[i].i]++;
 return cents;
}
export function estimateLinkedPrinting(lines:OrderLine[],products:Product[],data:PrintData):MatchedPrintEstimate{
 const pm=new Map(products.map(p=>[p.code,p])),groups=new Map<string,{line:OrderLine;quantity:number}>();
 for(const o of lines){const old=groups.get(o.code);groups.set(o.code,{line:o,quantity:(old?.quantity??0)+o.quantity});}
 const rows=[...groups].map(([code,{line,quantity}]):MatchedPrintRow=>{
  const {match,rule,source}=linkedRule(line,data),perPack=piecesPerPack(line,pm.get(code),match?.per_pack_override),issues:string[]=[];
  let pieces:number|null=null,sheets:number|null=null,cost:number|null=null,weight:number|null=null,printing:number|null=null,lamination:number|null=null,cutting:number|null=null;
  if(!rule)issues.push('待匹配打印规则');else if(!rule.enabled)issues.push('已匹配的打印规则已停用');
  else if(!perPack)issues.push('每份个数待补充');else if(!rule.per_sheet)issues.push('规则的可拼数量待填写');
  else if(!Number.isSafeInteger(quantity)||quantity<=0||!Number.isSafeInteger(quantity*perPack))issues.push('订单数量需核对');
  else{
   pieces=quantity*perPack;sheets=Math.ceil(pieces/rule.per_sheet);const rates=sheetPrice(rule);
   [printing,lamination,cutting]=priceParts(sheets,rates);
   if(printing==null)issues.push('材料及打印单价待填写或超出范围');
   if(lamination==null)issues.push('已选择覆膜，覆膜单价待填写或超出范围');
   if(cutting==null)issues.push('已选择切割，切割单价待填写或超出范围');
   if(printing!=null&&lamination!=null&&cutting!=null)cost=printing+lamination+cutting;
   if(rule.sheet_weight_g!=null)weight=Math.round(sheets*rule.sheet_weight_g*10000)/10000;
  }
  return {code,name:pm.get(code)?.name||line.title||code,quantity,pieces,sheets,cost_cents:cost,weight_g:weight,issues,per_pack:perPack,match_source:source,printing_cents:printing,lamination_cents:lamination,cutting_cents:cutting,...(rule?{rule_id:rule.id,rule_name:rule.name}:{}),formula:sheets==null?undefined:`${quantity}份 × 每份${perPack}个 ÷ 每张${rule!.per_sheet}个，向上取整`};
 });
 const total=(key:'sheets'|'cost_cents'|'weight_g')=>!rows.length||rows.some(r=>r[key]==null)?null:Math.round(rows.reduce((n,r)=>n+r[key]!,0)*10000)/10000;
 const codes=[...groups.keys()].sort(),used=new Set(rows.map(r=>r.rule_id).filter(Boolean));
 return {rows,sheets:total('sheets'),cost_cents:total('cost_cents'),weight_g:total('weight_g'),issues:rows.flatMap(r=>r.issues.map(i=>r.code+'：'+i)),rule_sizes:[],basis:JSON.stringify(['linked-v1',printBasis(lines),codes.map(c=>({code:c,pack:pm.get(c)?.pack??'',updated_at:pm.get(c)?.updated_at??0})),(data.printRules??[]).filter(r=>used.has(r.id)).sort((a,b)=>a.id.localeCompare(b.id)),(data.printRuleLinks??[]).filter(l=>codes.includes(l.code)),(data.printRuleMatches??[]).filter(m=>lines.some(o=>o.shop===m.shop&&o.order_id===m.order_id)&&codes.includes(m.code))])};
}
