// Rotation is harmless for rectangular size metadata, but never removes a
// design, colour or orientation label from the product/style name.
export const stockText=(s:string)=>s.toLowerCase().replace(/厘米|cm/g,'').replace(/[×*＊]/g,'x').replace(/\s/g,'');
export function stockSize(s:string){
 const value=stockText(s),m=value.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
 return m?m.slice(1).map(Number).sort((a,b)=>a-b).join('x'):value;
}
export function stockStyle(name:string){
 return stockText(name.replace(/[-－—_\s]*\d+\s*(贴|枚|张|个|件)(?:\s*[/／]\s*(份|包|套))?$/,'')
  .replace(/\d+(?:\.\d+)?\s*[x×*＊]\s*\d+(?:\.\d+)?\s*(?:cm|厘米)?/gi,''))
  .replace(/[-－—_]/g,'');
}
type Variant={product_id:string;inventory_group?:string;sku:string;name:string;size:string;material:string;pack_unit:string;category?:string};
export const stockIdentity=(v:Variant)=>JSON.stringify([v.product_id,v.inventory_group||'',stockStyle(v.name),stockSize(v.size),stockText(v.material),v.pack_unit,v.category||'']);
