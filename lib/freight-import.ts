import {cents,normalizeWaybill} from './freight-reconciliation';
import {billAmount} from './freight-amount';

export type BillTable={name:string;headers:{key:string;label:string}[];rows:{row:number;values:Record<string,string>}[]};
export type BillItem={tracking:string;fee_cents:number;carrier:string;raw_fee?:string};
const norm=(s:string)=>s.normalize('NFKC').replace(/[\s()（）]/g,'').toLowerCase();
export const trackingHeaders=['运单号','快递单号','物流单号','快递运单号','物流运单号','运单编号'];
export const feeHeaders=['结算金额','应收金额','实际运费','快递费用','快递费','运费','应付金额','合计费用','费用合计','总金额'];
export function detectColumn(headers:BillTable['headers'],aliases:string[]){return headers.find(h=>aliases.some(a=>norm(h.label).replace(/元$/,'')===norm(a)))?.key??'';}
export function billTables(sheets:{name:string;rows:BillTable['rows']}[]):BillTable[]{return sheets.flatMap(s=>{
 const header=s.rows.slice(0,30).find(r=>Object.values(r.values).some(v=>trackingHeaders.some(a=>norm(v)===norm(a))))??s.rows[0];
 if(!header)return [];return [{name:s.name,headers:Object.entries(header.values).map(([key,label])=>({key,label})),rows:s.rows.filter(r=>r.row>header.row)}];
});}
export function parseBillRows(table:BillTable,columns:{tracking:string;fee:string;carrier:string},known:Set<string>,mode:'total'|'components',defaultCarrier=''){
 if(!columns.tracking||!columns.fee)throw new Error('请选择运单号和费用列');
 const items=new Map<string,BillItem>(),errors:string[]=[],seen=new Set<string>();let skipped=0,duplicates=0,total=0,rounded=0;
 for(const r of table.rows){
  const raw=r.values[columns.tracking]??'';if(!raw.trim())continue;total++;
  let tracking:string;try{tracking=normalizeWaybill(raw);}catch{skipped++;continue;}
  if(!known.has(tracking)){skipped++;continue;}
  try{
   const parsed=billAmount(r.values[columns.fee],mode==='components'),fee=mode==='components'?cents(r.values[columns.fee],'费用明细',true):parsed.cents,carrier=(r.values[columns.carrier]||defaultCarrier).trim();
   const old=items.get(tracking),signature=JSON.stringify([tracking,fee,carrier]);
   if(mode==='total'&&old){if(Number(old.raw_fee)!==Number(parsed.raw))throw new Error('同一运单存在不同总费用，请检查费用列或选择“费用明细相加”');duplicates++;continue;}
   // Identical totals are duplicates; component rows are all retained, even equal surcharges.
   if(mode==='total'&&seen.has(signature)){duplicates++;continue;}seen.add(signature);
   if(parsed.rounded)rounded++;
   const amount=fee+(mode==='components'?(old?.fee_cents??0):0);
   items.set(tracking,{tracking,fee_cents:amount,carrier:carrier||old?.carrier||'',raw_fee:mode==='total'?parsed.raw:String(amount/100)});
  }catch(e){if(errors.length<8)errors.push(e instanceof Error?e.message:'账单费用无效');}
 }
 for(const item of items.values())if(item.fee_cents<0)errors.push(item.tracking+' 合计费用为负，请核对账单');
 if(errors.length)throw new Error(errors.join('；'));
 return {items:[...items.values()],total,skipped,duplicates,rounded};
}
