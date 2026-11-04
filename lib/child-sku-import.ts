import {readTableFile} from "./xlsx";
import {normalizeTableHeader,type TableRow} from "./merged-cells";
import {chinaTime, PHYSICAL_UNITS, stockUnit, type PhysicalStock, type Product} from "./model";
import {MAX_RECIPE_STOCKS} from "./recipe-limits";

export type ChildStockInput={code:string;name:string;spec:string;unit:string;quantity:number|null;count_at:number|null;cost:number|null;location:string};
export type ChildRecipeInput={sales_code:string;items:{stock_code:string;per_unit:number}[]};
export type ChildImport={stocks:ChildStockInput[];recipes:ChildRecipeInput[];rows:number};
type Sheet={name:string;rows:TableRow[]};
export const CHILD_SALES_HEADERS=["销售SKU编码","SKU编码","商家编码"];
const childHeaders=["子SKU编码","子sku编码","实物编码"];
export const CHILD_IMPORT_HEADERS=["销售SKU编码","子SKU编码","子SKU名称","每份扣减数量","库存单位","真实库存","盘点时间","单位成本","实物规格","库位"];
function childHeader(row:TableRow){
 const labels=new Set(Object.values(row.values).map(normalizeTableHeader));
 return CHILD_SALES_HEADERS.some(h=>labels.has(normalizeTableHeader(h)))&&childHeaders.some(h=>labels.has(normalizeTableHeader(h)));
}
export function hasChildImportHeaders(sheets:Sheet[]){return sheets.some(s=>!s.name.includes("示例")&&!s.name.includes("说明")&&s.rows.some(childHeader));}

function amount(raw:string,label:string,integer=true,max=100000000){
 const n=Number(raw);if(raw===""||!Number.isFinite(n)||n<0||n>max||(integer&&!Number.isSafeInteger(n)))throw new Error(label+"必须是有效的非负"+(integer?"整数":"金额"));return n;
}
function dateValue(raw:string){
 if(!raw)return null;
 // Excel serials represent local calendar time; inventory operates in China time.
 const at=/^\d+(\.\d+)?$/.test(raw)?Math.round((Number(raw)-25569)*86400000)-8*3600000:chinaTime(raw.replace(/\//g,"-"));
 if(!Number.isSafeInteger(at)||at<946684800000||at>Date.now()+60000)throw new Error("盘点时间无效或在未来，请填 YYYY-MM-DD HH:mm");return at;
}
export function childImportFromSheets(sheets:Sheet[]):ChildImport{
 const stocks=new Map<string,ChildStockInput>(),recipes=new Map<string,ChildRecipeInput>();let rows=0;
 for(const sheet of sheets){
  if(sheet.name.includes("示例")||sheet.name.includes("说明"))continue;
  const head=sheet.rows.find(childHeader);
  if(!head)continue;
  const labels=Object.fromEntries(Object.entries(head.values).map(([c,l])=>[normalizeTableHeader(l),c]));
  const salesCol=CHILD_SALES_HEADERS.find(h=>labels[normalizeTableHeader(h)]!==undefined)!,childCol=childHeaders.find(h=>labels[normalizeTableHeader(h)]!==undefined)!;
  if(labels["每份扣减数量"]===undefined)throw new Error("缺少列：每份扣减数量（卖1份扣几个子SKU）");
  for(const row of sheet.rows.filter(r=>r.row>head.row)){
   const val=(h:string)=>(row.values[labels[normalizeTableHeader(h)]]??"").trim();
   if(!Object.values(row.values).some(v=>v.trim()))continue;
   try{
    const sales=val(salesCol),code=val(childCol);
    if(!sales||!code)throw new Error("销售SKU编码和子SKU编码都要填写；一个对应关系占一行");
    if([sales,code].some(c=>c.length>160||/[\r\n]/.test(c)))throw new Error("编码过长或包含换行");
    const per_unit=amount(val("每份扣减数量"),"每份扣减数量",true,100000);if(!per_unit)throw new Error("每份扣减数量必须大于0");
    const name=val("子SKU名称"),unit=val("库存单位"),spec=val("实物规格"),location=val("库位");
    if(name.length>300||spec.length>500||location.length>160)throw new Error("名称、规格或库位过长");
    if(unit&&!PHYSICAL_UNITS.includes(unit))throw new Error("库存单位可填："+PHYSICAL_UNITS.join("、"));
    const s:ChildStockInput={code,name,unit,spec,location,quantity:val("真实库存")===""?null:amount(val("真实库存"),"真实库存"),count_at:dateValue(val("盘点时间")),cost:val("单位成本")===""?null:amount(val("单位成本"),"单位成本",false)};
    const old=stocks.get(code);
    if(old){
     for(const key of ["name","unit","spec","location","quantity","count_at","cost"] as const){
      if(s[key]===""||s[key]==null)continue;
      const label={name:"名称",unit:"单位",spec:"规格",location:"库位",quantity:"真实库存",count_at:"盘点时间",cost:"单位成本"}[key];
      if(old[key]!==""&&old[key]!=null&&old[key]!==s[key])throw new Error(`子SKU ${code} 的${label}不一致，同一实物请只填一次或填写相同值`);
      Object.assign(old,{[key]:s[key]});
     }
    }else stocks.set(code,s);
    const recipe=recipes.get(sales)??{sales_code:sales,items:[]};
    if(recipe.items.some(i=>i.stock_code===code))throw new Error("同一销售SKU与子SKU的关联重复，请合并为一行并填写扣减数量");
    recipe.items.push({stock_code:code,per_unit});if(recipe.items.length>MAX_RECIPE_STOCKS)throw new Error(`一个销售SKU最多关联${MAX_RECIPE_STOCKS}种实物`);recipes.set(sales,recipe);rows++;
    if(rows>20000)throw new Error("每个文件最多导入20000条关联，请拆分文件");
   }catch(e){throw new Error(`${sheet.name} 第${row.row}行：${e instanceof Error?e.message:e}`);}
  }
 }
 if(!rows)throw new Error("没有找到关联明细，请在“导入数据”中填写销售SKU编码、子SKU编码和每份扣减数量。示例与说明工作表不导入。");
 return {stocks:[...stocks.values()],recipes:[...recipes.values()],rows};
}
export async function parseChildImport(file:File){return childImportFromSheets(await readTableFile(file,{mergedHeaders:CHILD_SALES_HEADERS}));}

export function previewChildImport(input:ChildImport,products:Product[],stocks:PhysicalStock[]){
 const errors:string[]=[],existing=new Map(stocks.map(s=>[s.code,s])),sales=new Set(products.map(p=>p.code));
 for(const r of input.recipes)if(!sales.has(r.sales_code))errors.push("销售SKU尚未建档，请先在新品资料导入中建立："+r.sales_code);
 const children=input.stocks.map(s=>{
  const old=existing.get(s.code);
  if(old?.archived)errors.push("实物已移除，请先恢复："+s.code);
  if(!old&&(!s.name||!s.unit))errors.push("新子SKU需填写名称和库存单位："+s.code);
  if(old&&s.unit&&s.unit!==stockUnit(old))errors.push("库存单位与已有实物不同："+s.code);
  const status=old?(old.count_at!=null||old.quantity!=null?"保留已有库存":s.quantity==null?"仍待盘点":"首次确认库存"):s.quantity==null?"新建，待盘点":"新建并确认库存";
  return {...s,name:s.name||old?.name||"",unit:s.unit||stockUnit(old),status,existing:old};
 });
 return {children,errors};
}

// Keep every parent's full recipe in one atomic batch; shared children are safely reused.
export function childImportBatches(input:ChildImport){
 const stockMap=new Map(input.stocks.map(s=>[s.code,s])),batches:ChildImport[]=[];let batch:ChildImport={stocks:[],recipes:[],rows:0};
 for(const r of input.recipes){
  const codes=new Set([...batch.stocks.map(s=>s.code),...r.items.map(i=>i.stock_code)]);
  if(batch.recipes.length&&(batch.recipes.length>=20||codes.size>MAX_RECIPE_STOCKS||batch.rows+r.items.length>400)){batches.push(batch);batch={stocks:[],recipes:[],rows:0};}
  batch.recipes.push(r);batch.rows+=r.items.length;
  for(const i of r.items)if(!batch.stocks.some(s=>s.code===i.stock_code))batch.stocks.push(stockMap.get(i.stock_code)!);
 }if(batch.recipes.length)batches.push(batch);return batches;
}
