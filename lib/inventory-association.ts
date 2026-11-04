import {packQuantity,stockUnit,type Product,type PhysicalStock,type StockRule} from "./model";

export const normalizeSpec=(s:string)=>s.toLowerCase().replace(/厘米|cm/g,"").replace(/[x×*＊]/g,"×").replace(/\s/g,"");
export const salesBaseName=(s:string)=>s.replace(/[-－—_\s]*\d+\s*(?:贴|枚|张|个|件|包)(?:[（(][^）)]*[）)])?$/,"").replace(/[-－—_\s]+$/,"");
export const numericSticker=(p:Product)=>/数字贴|数码贴/.test(p.name+" "+p.category)||/^\d+\s*[-~～]\s*\d+$/.test(p.name);
export function salesPack(p:Product){
 const known=packQuantity(p),named=p.name.match(/(\d+)\s*(贴|枚|张|个|件|包)(?:[（(][^）)]*[）)])?$/);
 if(known&&named&&known!==Number(named[1]))return null;
 const n=known??(named?Number(named[1]):null);
 return n&&Number.isSafeInteger(n)&&n<=100000?n:null;
}
export function productBaseName(p:Product){const name=salesBaseName(p.name),n=salesPack(p);return name===p.name&&n?name.replace(new RegExp("[-－—_\\s]+"+n+"$"),""):name;}
export function salesRootCode(p:Product){const suffix=p.code.match(/-(\d+)$/);return suffix&&salesPack(p)===Number(suffix[1])?p.code.slice(0,-suffix[0].length):p.code;}
export const recipeSnapshot=(codes:string[],rules:StockRule[])=>codes.map(code=>({code,rules:rules.filter(rule=>rule.sales_code===code).map(({stock_code,per_unit})=>({stock_code,per_unit})).sort((a,b)=>a.stock_code.localeCompare(b.stock_code))}));
export function associationIssue(stock:Pick<PhysicalStock,"name"|"spec"|"unit">&{code?:string},selected:Product[],linked:Product[],checkName=true){
 const all=[...linked,...selected];
 if(all.some(numericSticker))return all.every(numericSticker)&&/数字贴|数码贴/.test(stock.name)?"":"数字贴请关联实际数字版面，不能与普通贴纸共用库存。";
 const names=new Set(all.map(p=>normalizeSpec(productBaseName(p))));
 if(names.size>1)return "这些SKU的款式不同，请使用“新增款式 / 尺寸”分别管理。";
 const sizes=new Set(all.map(p=>normalizeSpec(p.size||p.spec)).filter(Boolean));
 if(sizes.size>1)return "这些SKU的尺寸不同，请分别建立库存。";
 const materials=new Set(all.map(p=>normalizeSpec(p.material??"")).filter(Boolean));
 if(materials.size>1)return "这些SKU的材质不同，请分别建立库存。";
 if(checkName&&!linked.length&&selected.length&&stock.name&&normalizeSpec(salesBaseName(stock.name))!==normalizeSpec(productBaseName(selected[0]))&&stock.code?.replace(/-STOCK$/,"")!==salesRootCode(selected[0]))return "销售SKU的款式名称与当前库存不同，请核对或新增独立库存。";
 const size=all.find(p=>p.size||p.spec)?.size||all.find(p=>p.spec)?.spec;
 if(size&&stock.spec&&normalizeSpec(size)!==normalizeSpec(stock.spec))return "销售SKU的尺寸与当前库存规格不同，请核对后分别管理。";
 return "";
}
export type AssociationGroup={key:string;stock:Pick<PhysicalStock,"code"|"name"|"spec"|"unit">;existing:boolean;products:Product[]};
export function associationGroups(products:Product[],stocks:PhysicalStock[],rules:StockRule[]):AssociationGroup[]{
 const grouped=new Map<string,Product[]>();
 for(const p of products){
  if(numericSticker(p))throw new Error("数字贴需要按实际纸张版面建库存，请使用已有版面的“管理关联”。");
  if(/任选|自选|混选|随机|混合款/.test(p.name))throw new Error("自选或混合款请先确认实际发货款式，不能自动合成一种库存。");
  const key=JSON.stringify([normalizeSpec(productBaseName(p)),normalizeSpec(p.size||p.spec),normalizeSpec(p.material??""),p.category]);
  grouped.set(key,[...(grouped.get(key)??[]),p]);
 }
 const result=[...grouped].map(([key,items])=>{
  const p=items[0],root=salesRootCode(p);
  const code=root+"-STOCK",name=productBaseName(p),spec=p.size||p.spec;
  const linked=items.map(p=>rules.filter(r=>r.sales_code===p.code));
  const common=linked.length&&linked.every(r=>r.length===1&&r[0].stock_code===linked[0][0]?.stock_code)?linked[0][0]?.stock_code:undefined;
  const compatible=(s:PhysicalStock)=>!s.archived&&!associationIssue(s,items,[]);
  const match=stocks.find(s=>s.code===code&&compatible(s))??stocks.find(s=>s.code===common&&compatible(s));
  const unit=p.name.match(/\d+\s*(贴|枚|张|个|件|包)(?:[（(][^）)]*[）)])?$/)?.[1]??p.pack.match(/\d+\s*(贴|枚|张|个|件|包)/)?.[1]??"贴";
  return {key,products:items,existing:!!match,stock:match?{code:match.code,name:match.name,spec:match.spec,unit:stockUnit(match)}:{code,name,spec,unit}};
 });
 const taken=new Set<string>();
 return result.map((group,i)=>{
  if(!group.existing&&(stocks.some(s=>s.code===group.stock.code)||result.filter(g=>g.stock.code===group.stock.code).length>1||taken.has(group.stock.code))){
   const size=normalizeSpec(group.stock.spec).replace(/×/g,"x").replace(/[^\p{L}\p{N}._-]/gu,"")||"SIZE"+(i+1);
   const root=group.stock.code.replace(/-STOCK$/,"")+"-"+size;
   let code=root+"-STOCK",n=2;while(stocks.some(s=>s.code===code)||taken.has(code))code=root+"-"+(n++)+"-STOCK";
   group={...group,stock:{...group.stock,code}};
  }
  taken.add(group.stock.code);return group;
 });
}
