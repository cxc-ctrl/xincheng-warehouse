// Sequential chunks preserve shared-stock and whole-order processing order.
export const IMPORT_CHUNK_SIZE=200;
export const IMPORT_TRANSACTION_SIZE=40;
export function nextImportChunk<T>(rows:T[],start:number){
 let bytes=0,end=start;
 while(end<rows.length&&end-start<IMPORT_CHUNK_SIZE){
  const next=Math.min(rows.length,end+IMPORT_TRANSACTION_SIZE);
  const size=JSON.stringify(rows.slice(end,next)).length;
  if(end>start&&bytes+size>750000)break;
  bytes+=size;end=next;
 }
 return rows.slice(start,end);
}
