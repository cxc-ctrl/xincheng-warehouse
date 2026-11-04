import type {InventoryRow,Product} from "./model";
import {inventoryKey} from "./stocktake";

export type InventoryDisplayGroup={key:string;name:string;spec:string;rows:InventoryRow[];grouped:boolean};
const collator=new Intl.Collator("zh-CN",{numeric:true,sensitivity:"base"});
const normalized=(text:string)=>text.toLowerCase().replace(/厘米|cm/g,"").replace(/[×*]/g,"x").replace(/\s/g,"");
const signature=(values:string[])=>[...new Set(values.map(normalized).filter(Boolean))].sort().join("|");
const rangeSuffix=/(?:[·•:：\s_-]*[【\[(（]?\s*)(\d+)\s*[-–—~～至]\s*(\d+)\s*[】\])）]?\s*$/;

export function sheetRange(row:InventoryRow){
 const match=row.name.match(rangeSuffix);
 if(!match)return null;
 const start=Number(match[1]),end=Number(match[2]);
 if(!Number.isSafeInteger(start)||start<1||end<start)return null;
 const name=row.name.slice(0,match.index).replace(/[·•:：\s_-]+$/,"");
 return name?{start,end,name,label:`${start}～${end}`}:null;
}

// Presentation groups only: every row, count time and recipe remains independent.
// Keep design, dimensions, material, category and unit in the identity. A pack
// size or a common ERP prefix alone never makes two physical stocks fungible.
export function inventoryDisplayGroups(rows:InventoryRow[],products:Product[]=[]):InventoryDisplayGroup[]{
 const productMap=new Map(products.map(product=>[product.code,product]));
 const candidates=new Map<string,InventoryDisplayGroup>();
 for(const row of rows){
  const range=sheetRange(row);
  const numeric=row.kind==="physical"&&row.unit==="张"&&range&&/数字贴|数码贴/.test([row.name,...row.categories].join(" "));
  if(!numeric){candidates.set(inventoryKey(row),{key:inventoryKey(row),name:row.name,spec:row.spec,rows:[row],grouped:false});continue;}
  const linked=row.sales_codes.map(code=>productMap.get(code)).filter((product):product is Product=>!!product);
  const spec=row.spec.replace(/每张含数字\s*\d+\s*[-–—~～至]\s*\d+/g,"").replace(/[，,;；·\s]+$/,"");
  const prefix=row.code.replace(/[-_]\d+[-_]\d+$/,"");
  const key=JSON.stringify(["number-sheets",normalized(range.name),normalized(spec),row.unit,
   signature(row.categories.filter(category=>category!=="共用实物")),signature(linked.map(product=>product.size??"")),
   signature(linked.map(product=>product.material??"")),prefix===row.code?"":prefix]);
  const group=candidates.get(key)??{key,name:range.name,spec,rows:[],grouped:false};
  group.rows.push(row);candidates.set(key,group);
 }
 return [...candidates.values()].map(group=>({...group,grouped:group.rows.length>1,
  rows:[...group.rows].sort((a,b)=>{const x=sheetRange(a),y=sheetRange(b);return x&&y?x.start-y.start||x.end-y.end||collator.compare(a.code,b.code):collator.compare(a.name,b.name);})
 })).sort((a,b)=>collator.compare(a.name,b.name)||collator.compare(a.key,b.key));
}

export function visibleInventoryGroups(groups:InventoryDisplayGroup[],visible:InventoryRow[]){
 const keys=new Set(visible.map(inventoryKey));
 return groups.map(group=>({...group,visible:group.rows.filter(row=>keys.has(inventoryKey(row)))})).filter(group=>group.visible.length);
}
