import {withoutInvoiceAnnotations} from './digit-invoice-remarks';
import {groupedColorQuantities} from './digit-grouped-quantities';
import {applyRemarkRules,DEFAULT_REMARK_RULES,type DigitRemarkRule} from './digit-remark-rules';
import {digitColorCatalog as catalog} from '../data/digit-colors';
import {parseNumberRange} from './paper-plan';
import type {OrderLine,PhysicalStock,StockRule} from './model';

export type DigitVariant={base_code:string;color:string;stock_code:string;size:number;start:number;end:number;available_end:number};
export type ColorAllocation={color:string;quantity:number};
export type DigitItem=StockRule&{allocated_qty?:number};
export type DigitFulfillment={historical_counted?:boolean;order_key:string;status:'auto'|'manual'|'pending'|'print';color:string;reason:string;signature:string;updated_at:number;allocations?:ColorAllocation[];fixed_groups?:string};
export const RED_COLOR='红底白字';
export const DIGIT_CATALOG=catalog as {size:number;color:string;end:number}[];
export const COLOR_NAMES=[...new Set(DIGIT_CATALOG.map(r=>r.color))];
export function digitSheet(s:Pick<PhysicalStock,'name'|'code'>){
 const size=s.name.match(/红底白字\s*(1|3|5|10|15)\s*(?:cm|厘米)数字贴/i),range=parseNumberRange(s.name);
 return size&&range?{size:Number(size[1]),...range}:null;
}
export function digitSignature(o:OrderLine){return JSON.stringify([o.buyer_remark??'',o.seller_remark??'',o.spec,o.quantity,!!o.remarks_available]);}
const backgrounds=['玫红','咖啡','红','黄','绿','蓝','黑','白','紫','橙','粉','金','银','透明'];
const bg=(color:string)=>color.replace(/(?:底|色).*$/,'');
const normalize=(s:string)=>s.normalize('NFKC').replace(/【[^【】]*[|｜][^【】]*\d{1,2}[-/]\d{1,2}[^【】]*】|\[[^\[\]]*\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}[^\[\]]*\]/g,'').replace(/\r?\n+/g,'；').replace(/\s+/g,'').replace(/厎/g,'底').replace(/褐色|棕色/g,'咖啡色').replace(/(玫红|咖啡|红|黄|绿|蓝|黑|白|紫|橙)色底/g,'$1底').replace(/黄底黑子/g,'黄底黑字').replace(/篮色/g,'蓝色').replace(/浅蓝(?=色|底|白字|[，,、;；。]|$)/g,'蓝').replace(/橙色/g,'橙底').replace(/紫色/g,'紫底').replace(/(玫红|咖啡|红|黄|绿|蓝|黑|白|粉)色(?=(?:白|黑|黄|红)字)/g,'$1底');
const normalizedNames=new Map(COLOR_NAMES.map(c=>[normalize(c),c]));
const numberText='(?:\\d+|[一二三四五六七八九十百两]+)';
type Decision={color:string;reason:string;allocations:ColorAllocation[]};
function count(s:string){if(/^\d+$/.test(s))return Number(s);let total=0,n=0;for(const ch of s){if(ch==='十'){total+=(n||1)*10;n=0;}else if(ch==='百'){total+=(n||1)*100;n=0;}else n='零一二三四五六七八九'.indexOf(ch==='两'?'二':ch);}return total+n;}
const pending=(reason:string):Decision=>({color:'',reason,allocations:[]});
export const allocationLabel=(items:ColorAllocation[])=>items.length===1?items[0].color:items.map(a=>a.color+'×'+a.quantity+'份').join('；');
function finish(items:ColorAllocation[],quantity:number,reason:string):Decision{
 const merged=new Map<string,number>();for(const a of items)merged.set(a.color,(merged.get(a.color)??0)+a.quantity);
 const allocations=[...merged].map(([color,quantity])=>({color,quantity}));
 if(allocations.some(a=>!Number.isSafeInteger(a.quantity)||a.quantity<=0)||allocations.reduce((n,a)=>n+a.quantity,0)!==quantity)return pending('备注颜色分配数量与购买份数不一致，请核对');
 return {color:allocationLabel(allocations),reason,allocations};
}
function oneRemarkBase(raw:string,o:OrderLine,available:string[]):Decision|undefined{
 let text=normalize(raw.replace(/咖色/g,'咖啡色').replace(/粉(?=色|底|白字|[红黄绿蓝黑白紫橙玫咖粉金银透，,、/;；各×x*：:\d]|$)/g,'玫红'));if(!text)return;
 if(/^[A-Z]+[-—–－]\d+(?:[-—–－]\d+)+$/i.test(text))return pending('备注疑似内部编码，无法识别发货颜色或分配，请人工核对');
 const range=parseNumberRange(o.spec)||parseNumberRange(o.title),size=(o.title+' '+o.spec).match(/(?:直径)?(1|3|5|10|15)(?:cm|厘米|[x×*]\d)/i)?.[1];
 // First select the stated size, then its exact range. Commas can separate both
 // colours and SKU instructions, so only size/range markers delimit clauses.
 const dimensions=[...text.matchAll(/(?:直径)?(\d+(?:\.\d+)?)(?:cm|厘米|公分)/gi)];
 if(dimensions.length>1&&size){const segments=dimensions.map((m,i)=>({size:Number(m[1]),text:text.slice(m.index,dimensions[i+1]?.index)})).filter(c=>c.size===Number(size));if(segments.length)text=segments.map(c=>c.text).join('；');}
 const ranged=[...text.matchAll(/(\d+)[-—–～~至到](\d+)/g)];
 if(range&&ranged.length>1){const match=ranged.map((m,i)=>({start:Number(m[1]),end:Number(m[2]),text:text.slice(m.index,ranged[i+1]?.index)})).filter(c=>c.start===range.start&&c.end===range.end);if(match.length===1)text=match[0].text;else if(match.length>1&&match.length!==ranged.length)return pending('同一数字范围存在多条要求，请人工核对');}
 let mismatch=false;
 text=text.replace(/(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)(?:cm|厘米)?/gi,(_,a,b)=>{if(!size||Number(a)!==Number(size)||Number(b)!==Number(size))mismatch=true;return '';});
 text=text.replace(/(?:直径)?(\d+(?:\.\d+)?)(?:cm|厘米|公分)/gi,(_,n)=>{if(!size||Number(n)!==Number(size))mismatch=true;return '';});
 text=text.replace(/(\d+)[-—–～~至到](\d+)(?:号|的|个数的|个数|各[一1]个)?/g,(_,a,b)=>{if(!range||Number(a)!==range.start||Number(b)!==range.end)mismatch=true;return '';});
 if(mismatch)return pending('备注尺寸或数字范围与本SKU不一致，请核对');
 text=text.replace(/(?:别|不要)(?:发|弄|搞)错(?:了)?/g,'');
 text=text.replace(/不要((?:玫红|咖啡|红|黄|绿|蓝|黑|白|紫|橙)(?:底(?:白|黑|黄|红)字|底|色))(?:的)?(?:换成|改成|换|改为)((?:玫红|咖啡|红|黄|绿|蓝|黑|白|紫|橙)(?:底(?:白|黑|黄|红)字|底|色))/g,'$2');
 text=text.replace(/(?:不要|不能|不用|不发|别发)(?:用|走|发)?(?:圆通|中通|顺丰|申通|韵达|极兔)(?:快递|物流)?/g,'');
 if(/不要|不能|取消|除外|不是|非红|不发|别发/.test(text))return pending('备注有颜色排除或改动要求，请核对');
 text=text.replace(/字体(?:是|为)?(白|黑|黄|红)(?:色)?[，,、。]*底色(?:是|为)?(玫红|咖啡|红|黄|绿|蓝|黑|白|紫|橙)(?:色)?/g,(_,fg,b)=>b+'底'+fg+'字');
 text=text.replace(/(玫红|咖啡|红|黄|绿|蓝|黑|白|紫|橙)(?:色)?底[，,、。]*(白|黑|黄|红)(?:色)?字/g,'$1底$2字').replace(/(玫红|咖啡|红|黄|绿|蓝|黑|白|紫|橙)(?:色)?底(白|黑|黄|红)色/g,'$1底$2字');
 // A shared foreground applies only to the immediately preceding list of
 // backgrounds, e.g. 红底 蓝底 绿底 黄底 都要白字. Keep other clauses intact.
 const backgroundWord='(?:'+backgrounds.join('|')+')';
 text=text.replace(new RegExp('((?:'+backgroundWord+'(?:底|色)[，,、;；/和与]*)+)(?:都要|都用|全部用|统一用|全要)(白|黑|黄|红)(?:色)?字','g'),(_,list,foreground)=>list.replace(new RegExp('('+backgrounds.join('|')+')(?:底|色)','g'),(_m:string,background:string)=>background+'底'+foreground+'字'));
 text=text.replace(new RegExp('('+backgrounds.join('|')+')底色','g'),'$1底');
 const full=new RegExp('('+backgrounds.join('|')+')(?:底|色)('+backgrounds.join('|')+')字','g');let unknown=false;const missing:string[]=[];
 text=text.replace(full,m=>{const name=normalizedNames.get(m);if(!name){missing.push(m);return m;}return '§'+name+'§';});
 if(missing.length)return pending('备注颜色未配置对应库存：'+[...new Set(missing)].join('、'));
 const explicit=[...text.matchAll(/§([^§]+)§/g)].map(m=>m[1]);
 text=text.replace(/(?:白|黑|黄|红)色(?:数字|字体)/g,'字体要求');
 const token=new RegExp('§[^§]+§|(?:浅|深|荧光)?(?:'+backgrounds.join('|')+')(?:色|底)|(?:'+backgrounds.join('|')+')(?=[红黄绿蓝黑白紫橙玫咖粉金银透，,、/;；§各×x*：:\\d]|$)','g');
 text=text.replace(token,m=>{if(m.startsWith('§'))return m;if(/^(浅|深|荧光)/.test(m)){unknown=true;return m;}
  const background=m.replace(/(?:色|底)$/,''),precise=[...new Set(explicit.filter(c=>bg(c)===background))],candidates=precise.length?precise:background==='红'?[RED_COLOR]:background==='黄'?['黄底白字']:available.filter(c=>bg(c)===background);
  if(candidates.length!==1){unknown=true;return m;}return '§'+candidates[0]+'§';});
 if(unknown)return pending('颜色要求无法唯一匹配备货颜色，请核对');
 const occurrences=[...text.matchAll(/§([^§]+)§/g)].map(m=>m[1]),names=[...new Set(occurrences)];
 let kindsConflict=false;text=text.replace(new RegExp('('+numberText+')(?:款|种)(?:不同)?(?:颜色)?','g'),(_,n)=>{if(count(n)!==names.length)kindsConflict=true;return '';});if(kindsConflict)return pending('备注颜色种数与明确列出的颜色不一致，请核对');
 if(!names.length){if([...text.matchAll(new RegExp('('+numberText+')(?:份|套|组|张|件)','g'))].some(m=>count(m[1])!==o.quantity))return pending('备注数量与购买份数不一致，请核对');if(/颜色|底|字|混色|混合/.test(text))return pending('颜色要求无法唯一识别，请核对');return;}
 const rest=text.replace(/§[^§]+§/g,'').replace(/数字贴|数字|字母|颜色|底色|字体|白色数字/g,'');
 if(/底|色|字/.test(rest))return pending('备注还有未识别的颜色要求，请核对');
 const each=[...text.matchAll(new RegExp('各('+numberText+')(?:份|套|组|张|件|个)?','g'))].map(m=>count(m[1]));
 if(each.length){const items=groupedColorQuantities(text,numberText,count);return items?finish(items,o.quantity,'按备注的分组每色数量及单色数量自动分配'):pending('备注中颜色分组或每色数量不清晰，请核对');}
 const suffix=[...text.matchAll(new RegExp('§([^§]+)§[×x*：:]?('+numberText+')(?:份|套|组|张|件|个)?','g'))].map(m=>({color:m[1],quantity:count(m[2])}));
 const prefix=[...text.matchAll(new RegExp('('+numberText+')(?:份|套|组|张|件|个)(?:是|要|为)?(?:默认的)?§([^§]+)§','g'))].map(m=>({color:m[2],quantity:count(m[1])}));
 for(const amounts of [suffix,prefix])if(names.every(c=>amounts.some(a=>a.color===c)))return finish(amounts,o.quantity,'按备注明确的颜色和份数自动分配');
 if(suffix.length||prefix.length){const amounts=names.map(color=>{const ns=[...new Set([...suffix,...prefix].filter(a=>a.color===color).map(a=>a.quantity))];return {color,quantity:ns.length===1?ns[0]:0};});return finish(amounts,o.quantity,'按备注明确的颜色和份数自动分配');}
 if(names.length===1){const amounts=[...text.replace(/§[^§]+§/g,'').matchAll(new RegExp('('+numberText+')(?:份|套|组|张|件)','g'))].map(m=>count(m[1]));if(amounts.some(n=>n!==o.quantity))return pending('备注数量与购买份数不一致，请核对');return finish([{color:names[0],quantity:o.quantity}],o.quantity,'按备注明确的备货颜色发货');}
 if(names.length===o.quantity)return finish(names.map(color=>({color,quantity:1})),o.quantity,'颜色种数等于购买份数，自动每色分配1份');
 if(/均分|平均|各一半/.test(text)&&o.quantity%names.length===0)return finish(names.map(color=>({color,quantity:o.quantity/names.length})),o.quantity,'按备注明确的平均分配数量发货');
 return pending('备注包含多种颜色，但各颜色份数不清晰，请核对');
}
function oneRemark(raw:string,o:OrderLine,available:string[],source:'buyer'|'seller',rules:DigitRemarkRule[]):Decision|undefined{
 raw=withoutInvoiceAnnotations(raw).replace(/(\d+\s*[-—–～~至到]\s*\d+)[ \t]+(?=(?:\d+|[一二三四五六七八九十百两]+)\s*(?:份|套|组|张|件))/g,'$1：');
 if(/^[A-Z]+[-—–－]\d+(?:[-—–－]\d+)+$/i.test(normalize(raw)))return source==='seller'?undefined:pending('备注疑似内部编码，无法识别发货颜色或分配，请人工核对');
 if(/待确认|等确认|等通知|待定|尚未确定|还没确定/.test(normalize(raw)))return pending('发货要求尚未确定，请人工核对');
 const applied=applyRemarkRules(raw,o,source,rules);if(applied.issue)return pending(applied.issue);
 const result=oneRemarkBase(applied.text,o,available);return result&&applied.matches.length?{...result,reason:result.reason+'；命中规则：'+applied.matches.map(r=>r.name).join('、')}:result;
}
export function remarkColor(o:OrderLine,available=COLOR_NAMES,remarkRules:DigitRemarkRule[]=DEFAULT_REMARK_RULES):Decision{
 if(!o.remarks_available)return pending('ERP未提供买家/卖家备注列，请确认实际发货颜色');
 const sellerText=normalize(withoutInvoiceAnnotations(o.seller_remark??''));
 const seller=oneRemark(o.seller_remark??'',o,available,'seller',remarkRules);
 if(seller)return {...seller,reason:seller.reason.startsWith('建议整单打印')?seller.reason+'（采用客服备注）':'采用客服备注：'+seller.reason};
 const buyer=oneRemark(o.buyer_remark??'',o,available,'buyer',remarkRules);
 if(buyer)return {...buyer,reason:buyer.reason.startsWith('建议整单打印')?buyer.reason+'（采用顾客备注）':(sellerText?'客服无有效发货要求，采用顾客备注：':'采用顾客备注：')+buyer.reason};
 return finish([{color:RED_COLOR,quantity:o.quantity}],o.quantity,'双方无有效发货要求，默认红底白字');
}
export function colorRules(code:string,color:string,rules:StockRule[],variants:DigitVariant[]){
 const base=rules.filter(r=>r.sales_code===code);
 const digit=base.some(r=>variants.some(v=>v.base_code===r.stock_code));
 if(!digit)return null;
 if(!base.length||base.some(r=>!variants.some(v=>v.base_code===r.stock_code)))throw new Error('该销售SKU包含无法匹配的数字贴版面');
 return base.map(r=>{
  const v=variants.find(v=>v.base_code===r.stock_code&&v.color===color);
  if(!v)throw new Error('该颜色缺少对应数字版面，请选择实际可发的颜色');
  return {...r,stock_code:v.stock_code};
 });
}
export type {DigitCondition} from './warehouse-digit-conditions';
import type {DigitCondition} from './warehouse-digit-conditions';
export function fulfillmentPlan(o:OrderLine,rules:StockRule[],variants:DigitVariant[],stocks:PhysicalStock[],selected?:string|ColorAllocation[],conditions?:DigitCondition[],remarkRules:DigitRemarkRule[]=DEFAULT_REMARK_RULES){
 if(!rules.some(r=>r.sales_code===o.code&&variants.some(v=>v.base_code===r.stock_code)))return null;
 const sizes=new Set(variants.filter(v=>rules.some(r=>r.sales_code===o.code&&r.stock_code===v.base_code)).map(v=>v.size));
 const available=[...new Set(variants.filter(v=>sizes.has(v.size)).map(v=>v.color))];
 const decision=selected?finish(typeof selected==='string'?[{color:selected,quantity:o.quantity}]:selected,o.quantity,'仓库确认实际发货颜色'):remarkColor(o,available,remarkRules);
 if(!decision.allocations.length)return {...decision,items:[] as DigitItem[],status:'pending' as const};
 try{
  const items:DigitItem[]=[];
  const saleRange=parseNumberRange(o.spec)||parseNumberRange(o.title);
  if(!saleRange)throw new Error('订单数字范围不清晰，请核对销售规格');
  for(const a of decision.allocations){const parts=colorRules(o.code,a.color,rules,variants);if(!parts?.length)throw new Error('无法匹配颜色版面');for(const r of parts){const v=variants.find(v=>v.stock_code===r.stock_code);const c=conditions?.find(c=>c.color===a.color&&c.size===v?.size);if(conditions&&(!c||!c.enabled))throw new Error('数字贴条件未设置或已停用，请到仓库配置');if(c&&(saleRange.start<c.start||saleRange.end>c.end))throw new Error(c.out_of_range==='建议整单打印'?'建议整单打印：超出仓库配置的备货范围，须人工确认':'销售数字范围超出仓库配置的备货范围，请人工核对');if(!c&&v&&saleRange.end>v.available_end)throw new Error('销售数字范围超出该颜色备货范围，请核对实际发货');items.push({...r,allocated_qty:a.quantity});}}
  for(const r of items){const s=stocks.find(s=>s.code===r.stock_code&&!s.archived);if(!s)throw new Error('对应颜色库存已移除，请先建立对应库存');if(s.quantity==null)throw new Error('对应颜色库存尚未盘点，请先盘点再确认');if(s.quantity<r.allocated_qty!*r.per_unit){const v=variants.find(v=>v.stock_code===r.stock_code),c=conditions?.find(c=>c.color===v?.color&&c.size===v?.size);throw new Error((c?.shortage==='建议整单打印'?'建议整单打印：库存不足，须人工确认；':'对应颜色库存不足：')+s.name+'需'+r.allocated_qty!*r.per_unit+'张，现存'+s.quantity+'张');}}
  return {...decision,items,status:'auto' as const};
 }catch(e){return {...decision,reason:e instanceof Error?e.message:'颜色版面无法匹配',items:[] as DigitItem[],status:'pending' as const};}
}
