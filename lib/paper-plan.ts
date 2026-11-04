import {MAX_RECIPE_STOCKS} from "./recipe-limits";
export type PaperDraft = {code:string;name:string;spec:string;start:number;end:number};
export type PaperPlanInput = {name:string;prefix:string;start:number;end:number;perSheet:number};

export function makePaperPlan(input:PaperPlanInput):PaperDraft[] {
 const {name,prefix,start,end,perSheet}=input;
 if(!name.trim()||!prefix.trim()||/[\r\n]/.test(prefix))throw new Error("请填写纸张名称和内部编码前缀");
 if(![start,end,perSheet].every(Number.isSafeInteger)||start<1||end<start||end>100000||perSheet<1)throw new Error("请填写正确的数字范围和每张含量");
 if(Math.ceil((end-start+1)/perSheet)>MAX_RECIPE_STOCKS)throw new Error(`一次最多生成${MAX_RECIPE_STOCKS}种纸张，请缩小数字范围`);
 return Array.from({length:Math.ceil((end-start+1)/perSheet)},(_,i)=>{
  const a=start+i*perSheet,z=Math.min(end,a+perSheet-1),range=a+"～"+z;
  const code=prefix.trim()+"-"+a+"-"+z;
  if(code.length>160||name.trim().length+range.length+2>300)throw new Error("名称或编码过长，请缩短");
  return {code,name:name.trim()+" "+range,spec:"每张含数字"+range,start:a,end:z};
 });
}

export function parseNumberRange(text:string):{start:number;end:number}|null {
 const matches=[...text.matchAll(/(\d+)\s*[-–—~～至]\s*(\d+)/g)];
 const m=matches.at(-1);
 if(!m)return null;
 const start=Number(m[1]),end=Number(m[2]);
 return Number.isSafeInteger(start)&&start>=1&&end>=start?{start,end}:null;
}

export function papersForRange(papers:PaperDraft[],start:number,end:number):PaperDraft[] {
 if(!papers.length||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start< papers[0].start||end>papers.at(-1)!.end||end<start)throw new Error("销售数字范围必须在本次纸张范围内");
 return papers.filter(p=>p.start<=end&&p.end>=start);
}
