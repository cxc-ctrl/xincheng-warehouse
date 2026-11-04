import type {OrderLine} from './model';
export type DigitRemarkRule={id:string;name:string;keywords:string[];exclude_keywords:string[];source:'buyer'|'seller'|'both';size_cm:number|null;action:'color'|'review'|'print';color:string;enabled:number;updated_at:number};
export const REMARK_ACTIONS={color:'识别为指定颜色',review:'转人工核对',print:'建议整单打印'};
export const REMARK_SOURCES={buyer:'买家备注',seller:'卖家备注',both:'买家与卖家备注'};
// This is the former built-in special-production check, now editable in the UI.
export const DEFAULT_REMARK_RULES:DigitRemarkRule[]=[{id:'builtin-special-production',name:'特殊制作先人工核对',keywords:['定制','按图','看图','改数字','改编号','额外','另做','加印','多做','粗体','随机','没有就'],exclude_keywords:[],source:'both',size_cm:null,action:'review',color:'',enabled:1,updated_at:0}];
export const literalRemark=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
export function orderDigitSize(o:Pick<OrderLine,'spec'|'title'>){const m=(o.spec+' '+o.title).match(/(?:直径)?(\d+(?:\.\d+)?)\s*(?:cm|厘米|公分)/i);return m?Number(m[1]):null;}
export function remarkRuleMatches(raw:string,o:Pick<OrderLine,'spec'|'title'>,source:'buyer'|'seller',rules:DigitRemarkRule[]){
 const text=literalRemark(raw),size=orderDigitSize(o);
 return rules.filter(r=>r.enabled===1&&(r.source==='both'||r.source===source)&&(r.size_cm==null||r.size_cm===size)&&!r.exclude_keywords.some(k=>text.includes(literalRemark(k)))&&r.keywords.some(k=>text.includes(literalRemark(k))));
}
export function applyRemarkRules(raw:string,o:Pick<OrderLine,'spec'|'title'>,source:'buyer'|'seller',rules:DigitRemarkRule[]){
 const matches=remarkRuleMatches(raw,o,source,rules),review=matches.filter(r=>r.action==='review'),printing=matches.filter(r=>r.action==='print');
 if(review.length)return {text:raw,matches,issue:'规格 / 数量需核对：命中备注规则：'+review.map(r=>r.name).join('、')+'；请人工核对'};
 if(printing.length)return {text:raw,matches,issue:'建议整单打印：命中备注规则 '+printing.map(r=>r.name).join('、')+'，须人工确认'};
 const aliases=matches.filter(r=>r.action==='color'),tokens=aliases.flatMap(r=>r.keywords.map(k=>({keyword:literalRemark(k),color:r.color,name:r.name}))).sort((a,b)=>b.keyword.length-a.keyword.length);
 let text=literalRemark(raw),out='';
 // Replace literal aliases once, without rescanning replacement text or treating keywords as regex.
 for(let i=0;i<text.length;){const at=tokens.filter(t=>text.startsWith(t.keyword,i));if(!at.length){out+=text[i++];continue;}
  const colors=new Set(at.map(t=>t.color));if(colors.size!==1)return {text:raw,matches,issue:'备注规则颜色冲突：'+at.map(t=>t.name).join('、')+'；请人工核对'};
  out+=at[0].color;i+=at[0].keyword.length;
 }
 return {text:aliases.length?out:raw,matches,issue:''};
}
