import {PHYSICAL_UNITS,type Product,type PhysicalStock,type StockRule} from "./model";
import {readTableFile} from "./xlsx";
import {type TableRow} from "./merged-cells";

export const CATALOG_HEADERS=["ERP编码","SKU编码","规格名称","尺寸","每款SKU数量","数量单位","成本","材质","品类","库存方式","共用库存编码","备注"];
export const CATALOG_MODES=["独立库存","共用库存","待关联","仅统计销售"];
export const CATALOG_MERGED_HEADERS=["ERP编码","尺寸","材质","品类","数量单位","库存方式","共用库存编码"];
export type CatalogItem={erp_code:string;code:string;name:string;size:string;pack_quantity:number;pack_unit:string;cost:number|null;material:string;category:string;inventory_mode:string;stock_code:string;note:string};
const dimension=(s:string)=>s.toLowerCase().replace(/厘米|cm/g,'').replace(/[x＊*]/g,'×').replace(/\s/g,'');
const design=(s:string)=>/\d+\s*(贴|枚|张|个|件|包)$/.test(s)?s.replace(/[-－—_\s]*\d+\s*(贴|枚|张|个|件|包)$/,'').replace(/\s/g,''):null;
export function assertCatalogIdentity(item:CatalogItem,linked:Pick<Product,'name'|'size'|'material'>[]){
 for(const prior of linked){
  if(item.size&&prior.size&&dimension(item.size)!==dimension(prior.size))throw new Error('共用库存尺寸冲突：'+item.stock_code+'（'+prior.size+' / '+item.size+'）');
  if(item.material&&prior.material&&item.material.replace(/\s/g,'')!==prior.material.replace(/\s/g,''))throw new Error('共用库存材质冲突：'+item.stock_code);
  const a=design(item.name),b=design(prior.name);
  if(a&&b&&a!==b)throw new Error('共用库存款式名称不同，请核对后分别建档或手动关联：'+item.stock_code);
 }
}
export function validateCatalog(items:CatalogItem[]){
 if(!items.length)throw new Error("没有找到新品资料，请填写“新品资料”工作表后上传。");
 const seen=new Set<string>(),groups=new Map<string,string>();
 for(const item of items){
  for(const [field,max] of [["erp_code",160],["code",160],["name",300],["size",160],["material",160],["category",160],["stock_code",160],["note",1000]] as const)if(typeof item[field]!=="string"||item[field].length>max)throw new Error("新品字段格式或长度无效："+field);
  if(!item.code.trim()||!item.name.trim()||item.code!==item.code.trim()||item.stock_code!==item.stock_code.trim()||/[\r\n]/.test(item.code+item.stock_code))throw new Error("请填写SKU编码和规格名称，编码不能换行。");
  if(seen.has(item.code))throw new Error("SKU编码重复："+item.code);seen.add(item.code);
  if(!Number.isSafeInteger(item.pack_quantity)||item.pack_quantity<1||item.pack_quantity>100000||!PHYSICAL_UNITS.includes(item.pack_unit))throw new Error("每款SKU数量或数量单位无效："+item.code);
  if(item.cost!==null&&(typeof item.cost!=="number"||!Number.isFinite(item.cost)||item.cost<0||item.cost>100000000))throw new Error("成本必须为非负金额，未知时留空："+item.code);
  if(!CATALOG_MODES.includes(item.inventory_mode))throw new Error("请选择库存方式："+item.code);
  if(item.inventory_mode==="共用库存"){
   if(!item.stock_code.trim())throw new Error("共用库存必须填写共用库存编码："+item.code);
   assertCatalogIdentity(item,items.filter(other=>other!==item&&other.stock_code===item.stock_code));
   const identity=JSON.stringify([item.size,item.material,item.pack_unit]),prior=groups.get(item.stock_code);
   if(prior&&prior!==identity)throw new Error("同一共用库存的尺寸、材质和数量单位必须相同："+item.stock_code);
   groups.set(item.stock_code,identity);
  }else if(item.stock_code)throw new Error("只有“共用库存”方式填写共用库存编码："+item.code);
 }
 return items;
}
export async function parseCatalog(file:File){
 return catalogFromSheets(await readTableFile(file,{mergedHeaders:CATALOG_MERGED_HEADERS}));
}
export function catalogFromSheets(sheets:{name:string;rows:TableRow[]}[]){
 const items:CatalogItem[]=[];
 for(const sheet of sheets){
  if(sheet.name.includes("说明")||sheet.name.includes("示例"))continue;
  const header=sheet.rows.find(row=>Object.values(row.values).some(value=>value.toUpperCase()==="SKU编码")&&Object.values(row.values).includes("规格名称"));if(!header)continue;
  const labels=Object.fromEntries(Object.entries(header.values).map(([col,name])=>[name.toUpperCase(),col]));
  for(const row of sheet.rows.filter(row=>row.row>header.row)){
   const get=(name:string)=>(row.values[labels[name.toUpperCase()]]??"").trim();
   if(!CATALOG_HEADERS.some(name=>get(name)))continue;
   if(!get("每款SKU数量"))throw new Error(`第 ${row.row} 行：请填写每款SKU数量。`);
   items.push({erp_code:get("ERP编码"),code:get("SKU编码"),name:get("规格名称"),size:get("尺寸"),pack_quantity:Number(get("每款SKU数量")),pack_unit:get("数量单位"),cost:get("成本")===""?null:Number(get("成本")),material:get("材质"),category:get("品类")||"未分类",inventory_mode:get("库存方式"),stock_code:get("共用库存编码"),note:get("备注")});
  }
 }
 return validateCatalog(items);
}
export function previewCatalog(items:CatalogItem[],products:Product[],stocks:PhysicalStock[],rules:StockRule[]=[]){
 validateCatalog(items);
 return items.map(item=>{
  const stock=stocks.find(stock=>stock.code===item.stock_code);
  if(item.inventory_mode==="共用库存"&&stock&&(stock.archived||stock.unit&&stock.unit!==item.pack_unit))throw new Error("已有共用库存已移除或单位不一致："+item.stock_code);
  if(stock)assertCatalogIdentity(item,products.filter(p=>rules.some(r=>r.stock_code===stock.code&&r.sales_code===p.code)));
  return {item,exists:products.some(product=>product.code===item.code)};
 });
}
