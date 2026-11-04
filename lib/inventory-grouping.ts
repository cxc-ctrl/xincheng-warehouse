import {isPrintOnly,type Product,type PhysicalStock,type StockRule,type OrderLine} from "./model";

export type InventoryGroup={prefix:string;name:string;spec:string;unit:string;stock_code:string;basis:string;links:{code:string;per_unit:number}[]};
export type GroupingIssue={prefix:string;codes:string[];reason:string};
type Input={products:Product[];physical:PhysicalStock[];rules:StockRule[];orders?:Pick<OrderLine,"code"|"deducted_qty">[]};
const unique=(items:string[])=>[...new Set(items.filter(Boolean))];
const norm=(s:string)=>s.toLowerCase().replace(/厘米|cm/g,"").replace(/[×*]/g,"x").replace(/\s/g,"");
const baseName=(name:string)=>name.replace(/(?:[-－\s]*共)?\d+\s*\.?\s*(?:贴|枚|张|个|件)?(?:[（(][^）)]*[）)])?$/,"").replace(/[-－\s]+$/,"");

// A trailing number is a pack size only when the product's pack/name corroborates it.
// In particular, -01 is a design identifier, and number stickers use paper recipes.
function packaging(p:Product){
 const text=p.pack.trim();
 const pack=text.match(/^(\d+)\s*(贴|枚|张|个|件)?(?:\s*[\/／]\s*(?:包|份|套))?$/)
  ??text.match(/^\d+张\s*(\d+)(贴)$/)
  ??text.match(/^(\d+)(贴)\s*[\/／]\s*\d+张$/);
 const name=p.name.match(/(?:^|[^\d.])(\d+)\s*(贴|枚|张|个|件)(?:[（(][^）)]*[）)])?$/)
  ??p.name.match(/[-－ ](\d+)$/);
 if(text&&!pack)return null;
 if(pack&&name&&Number(pack[1])!==Number(name[1]))return null;
 const n=Number(pack?.[1]??name?.[1]);
 if(!Number.isSafeInteger(n)||n<1||n>100000)return null;
 const explicit=unique([pack?.[2]??"",name?.[2]??""]);
 if(explicit.length>1)return null;
 const unit=explicit[0]||(/贴|标签/.test(p.category+" "+p.name)?"贴":/贺卡|保存卡/.test(p.category)?"张":"");
 return unit?{n,unit}:null;
}

export function inventoryGrouping(input:Input){
 const groups:InventoryGroup[]=[],issues:GroupingIssue[]=[];
 const used=new Set(input.orders?.filter(o=>(o.deducted_qty??0)>0).map(o=>o.code));
 const candidates=new Map<string,{p:Product;n:number;unit:string}[]>();
 let special=0;
 for(const p of input.products){
  if(isPrintOnly(p)||p.tracking_enabled===0)continue;
  if(p.supply_mode==='现货优先（按条件）'||/数字贴|数码贴/.test(p.category+" "+p.name)||/SZT-/i.test(p.code)||/^\d+\s*[-~～]\s*\d+$/.test(p.name)){special++;continue;}
  if(p.stock_mode==='recipe'&&input.rules.some(r=>r.sales_code===p.code))continue;
  const pack=packaging(p);if(!pack){issues.push({prefix:p.code,codes:[p.code],reason:'每份含量或库存单位无法明确识别，请核对'});continue;}
  const suffix=p.code.match(/-([1-9]\d*)$/);
  const prefix=(suffix&&Number(suffix[1])===pack.n?p.code.slice(0,-suffix[0].length):p.code).trim();
  const rows=candidates.get(prefix)??[];rows.push({p,...pack});candidates.set(prefix,rows);
 }
 for(const [prefix,rows] of [...candidates].sort(([a],[b])=>a.localeCompare(b))){
  const products=rows.map(r=>r.p),codes=products.map(p=>p.code).sort();
  // A matching-prefix product that could not be parsed must not silently disappear.
  const unparsed=input.products.filter(p=>!isPrintOnly(p)&&!codes.includes(p.code)&&(p.code.trim()===prefix||p.code.replace(/-\d+$/,"").trim()===prefix));
  const specs=unique(products.map(p=>norm(p.size||p.spec||"")));
  const materials=unique(products.map(p=>norm(p.material||"")));
  let reason="";
  const allAssociated=products.every(p=>p.stock_mode==="recipe"&&input.rules.some(r=>r.sales_code===p.code));
  if(allAssociated)continue;
  if(unparsed.length)reason="同前缀有包装数量无法确认的SKU";
  else if(products.some(p=>/任选|自选|混选|随机|混合|混装|组合|套装/.test(p.name)))reason="包含混合或组合款，需要确认实际发货组成";
  else if(products.some(p=>p.tracking_enabled===0))reason="包含仅统计销售的SKU";
  else if(products.some(p=>input.rules.some(r=>r.sales_code===p.code)))reason="已有实物关联，保留原规则";
  else if(products.some(p=>p.quantity!=null||p.count_at!=null||used.has(p.code)))reason="已有实盘或独立扣减记录，需核对后合并";
  else if(products.some(p=>!(p.size||p.spec)||!p.material))reason="尺寸或材质未填写，请补齐后建立库存";
  else if(specs.length>1||materials.length>1||unique(products.map(p=>p.category)).length>1||unique(products.map(p=>p.source_product||'')).length>1)reason="同前缀的产品、尺寸、材质或品类不一致";
  else if(unique(products.map(p=>baseName(p.name).replace(/[-－\s]/g,""))).length>1)reason="同前缀的款式名称不一致，请核对实物";
  else if(unique(rows.map(r=>r.unit)).length>1)reason="包装计量单位不一致";
  else if(rows.length>20)reason="同款包装超过20个，请分批核对";
  const stock_code=prefix+"-STOCK";
  if(!reason&&input.physical.some(s=>s.code===stock_code))reason="已有同编码实物，需核对关联";
  if(reason){issues.push({prefix,codes:[...codes,...unparsed.map(p=>p.code)],reason});continue;}
  const first=[...products].sort((a,b)=>a.code.localeCompare(b.code))[0];
  const name=baseName(first.name)||prefix;
  if(stock_code.length>160){issues.push({prefix,codes,reason:'库存编码过长，请单独设置'});continue;}
  const basis=JSON.stringify([...products].sort((a,b)=>a.code.localeCompare(b.code)).map(p=>[p.code,p.name,p.pack,p.size||p.spec,p.material,p.category,p.source_product,p.supply_mode,p.updated_at,p.synced_at,p.stock_mode,p.tracking_enabled]));
  groups.push({prefix,name,spec:products.find(p=>p.size||p.spec)?.size||products.find(p=>p.spec)?.spec||"",unit:rows[0].unit,stock_code,basis,links:rows.map(r=>({code:r.p.code,per_unit:r.n})).sort((a,b)=>a.code.localeCompare(b.code))});
 }
 return {groups,issues,special,reduction:groups.reduce((n,g)=>n+g.links.length-1,0)};
}

// An exact preview token prevents a stale browser plan from silently changing recipes.
export const groupToken=(g:InventoryGroup)=>JSON.stringify(g);
