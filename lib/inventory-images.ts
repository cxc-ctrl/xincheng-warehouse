import type {InventoryRow,Product,ProductImage,StockRule} from './model';
import {inventoryKey} from './stocktake';

function uniqueImages(images:ProductImage[]):ProductImage[]{
 const seen=new Set<string>();
 return images.filter(image=>{if(seen.has(image.id))return false;seen.add(image.id);return true;});
}

// Only explicit inventory links identify a physical style. A mixed pack may
// consume several styles, so its picture cannot stand in for any one of them.
export function inventoryImageIndex(rows:InventoryRow[],products:Product[],rules:StockRule[]){
 const byCode=new Map(products.map(product=>[product.code,product]));
 const components=new Map<string,Set<string>>();
 for(const rule of rules){const stocks=components.get(rule.sales_code)??new Set<string>();stocks.add(rule.stock_code);components.set(rule.sales_code,stocks);}
 return new Map(rows.map(row=>{
  const codes=row.kind==='product'?[row.code]:row.sales_codes.filter(code=>components.get(code)?.size===1&&components.get(code)?.has(row.code));
  return [inventoryKey(row),uniqueImages(codes.flatMap(code=>byCode.get(code)?.images??[]))] as const;
 }));
}

export function inventoryGroupImages(rows:InventoryRow[],index:Map<string,ProductImage[]>){
 return uniqueImages(rows.flatMap(row=>index.get(inventoryKey(row))??[]));
}
