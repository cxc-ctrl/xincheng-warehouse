import type {InventoryRow} from "./model";

export type CountInput={code:string;quantity:number;kind?:InventoryRow["kind"];unit?:string};
export const inventoryKey=(row:Pick<InventoryRow,"kind"|"code">)=>JSON.stringify([row.kind,row.code]);
export const inventoryKindLabel=(kind:InventoryRow["kind"])=>kind==="physical"?"共用实物":"独立成品";

// An ERP sales code can also be the code of a physical pool. Resolve against
// the real ledger, and require an explicit type when both records exist.
export function resolveCounts(items:CountInput[],rows:InventoryRow[]){
 const seen=new Set<string>();
 return items.map(item=>{
  const matches=rows.filter(row=>row.code===item.code&&(!item.kind||row.kind===item.kind));
  if(!matches.length)throw new Error("没有可盘点的实物记录："+item.code+"。共用库存请填写主库存编码。");
  if(matches.length>1)throw new Error("编码对应多种库存，请填写记录类型："+item.code);
  const row=matches[0],key=inventoryKey(row);
  if(item.unit&&item.unit!==row.unit)throw new Error(item.code+" 的库存单位应为“"+row.unit+"”，请核对数量后再导入。");
  if(!Number.isSafeInteger(item.quantity)||item.quantity<0||item.quantity>100000000)throw new Error("实盘数量必须为有效非负整数："+item.code);
  if(seen.has(key))throw new Error("实物记录重复："+item.code);
  seen.add(key);return {row,key,quantity:item.quantity};
 });
}

export function countBatches(edits:Record<string,string>,rows:InventoryRow[]){
 const map=new Map(rows.map(row=>[inventoryKey(row),row]));
 const entries=Object.entries(edits).filter(([,value])=>value!=="").map(([key,value])=>{
  const row=map.get(key);if(!row)throw new Error("待保存的库存已移除或改变，请清空该项后重新盘点。");
  return {code:row.code,kind:row.kind,unit:row.unit,quantity:Number(value)};
 });
 const confirmed=resolveCounts(entries,rows);
 return (["physical","product"] as const).flatMap(kind=>{
  const items=confirmed.filter(item=>item.row.kind===kind),batches=[];
  for(let i=0;i<items.length;i+=10){const part=items.slice(i,i+10);batches.push({action:kind==="physical"?"physical_count":"count",items:part.map(item=>({code:item.row.code,quantity:item.quantity})),keys:part.map(item=>item.key)});}
  return batches;
 });
}

export function countTemplate(rows:InventoryRow[]){
 return [["记录类型","实物编码","名称","规格","库存单位","实盘数量"],...rows.map(row=>[inventoryKindLabel(row.kind),row.code,row.name,row.spec,row.unit,""])];
}
