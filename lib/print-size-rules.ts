import type {OrderLine} from './model';
import type {PrintSizeRule} from './printing';

const normalize=(text:string)=>text.normalize('NFKC').replace(/\s+/g,'').replace(/[－—–~～至到]/g,'-');
const unique=<T>(values:T[])=>[...new Set(values)];
function dimensions(text:string):number[]{
 const s=normalize(text),sizes:number[]=[];
 for(const m of s.matchAll(/(\d+(?:\.\d+)?)[xX×*](\d+(?:\.\d+)?)(?:cm|厘米|公分)/gi)){
  if(Number(m[1])!==Number(m[2]))return [-1];
  sizes.push(Number(m[1]));
 }
 const remaining=s.replace(/\d+(?:\.\d+)?[xX×*]\d+(?:\.\d+)?(?:cm|厘米|公分)/gi,'');
 for(const m of remaining.matchAll(/(\d+(?:\.\d+)?)(?:cm|厘米|公分)/gi))sizes.push(Number(m[1]));
 return unique(sizes);
}
function ranges(text:string){return unique([...normalize(text).matchAll(/(?<![\d.])(\d+)-(\d+)(?![\d.])/g)].map(m=>Number(m[1])+':'+Number(m[2])));}
export type PrintRange={size:number;start:number;end:number;repeat:number;pieces:number;issue?:string};
/** Read the ordered specification, never a SKU suffix or a colour remark as a quantity. */
export function printRange(o:Pick<OrderLine,'title'|'spec'|'buyer_remark'|'seller_remark'>):PrintRange|null{
 const specs=dimensions(o.spec),sizes=specs.length?specs:dimensions(o.title);
 const specRanges=ranges(o.spec),rs=specRanges.length?specRanges:ranges(o.title);
 if(!sizes.length||!rs.length)return null;
 const [start,end]=rs[0].split(':').map(Number),size=sizes[0];
 const result:PrintRange={size,start,end,repeat:1,pieces:0};
 if(sizes.length!==1||size<=0||size>200||rs.length!==1||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>1000000)return {...result,issue:'尺寸或数字范围不明确，请人工核对'};
 const source=normalize(specRanges.length?o.spec:o.title);
 const words:Record<string,number>={一:1,两:2,二:2};
 const repeats=unique([...source.matchAll(/各(\d+|一|两|二)(?:个|枚|贴|张)/g)].map(m=>words[m[1]]??Number(m[1])));
 if(repeats.length>1||repeats.some(n=>!Number.isSafeInteger(n)||n<=0)||/每(?:个)?(?:数字|号)|重复|多套|混合|随机/.test(source))return {...result,issue:'每个数字的重复数量或版面不明确，请人工核对'};
 result.repeat=repeats[0]??1;result.pieces=(end-start+1)*result.repeat;
 const totals=[...source.matchAll(/共(\d+)(?:个|枚|贴|张)/g)].map(m=>Number(m[1]));
 if(totals.some(n=>n!==result.pieces))return {...result,issue:'数字范围与标注总数量不一致，请人工核对'};
 for(const note of [o.buyer_remark??'',o.seller_remark??'']){
  const ds=dimensions(note),r=ranges(note);
  if(ds.some(n=>n!==size)||r.some(s=>s!==start+':'+end))return {...result,issue:'备注更改了尺寸或数字范围，请先核对实际打印规格'};
 }
 if(!Number.isSafeInteger(result.pieces)||result.pieces>100000000)return {...result,issue:'打印数量超出范围，请人工核对'};
 return result;
}
export const printSizeKey=(r:Pick<PrintSizeRule,'size_cm'>)=>String(r.size_cm);
