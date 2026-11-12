export type ProductImage={id:string;url:string;thumbnail_url:string};
export type Product={product_name?:string;source_revision?:number;synced_at?:number;images?:ProductImage[];price?:number|null;source_product?:string;cost_mode?:string;dynamic_cost?:boolean;supply_mode?:string;erp_code?:string;size?:string;material?:string;code:string;name:string;category:string;spec:string;pack:string;unit:string;cost:number|null;quantity:number|null;count_at:number|null;location:string;minimum:number;note:string;source:string;updated_at:number;stock_mode?:"direct"|"recipe";recipe_at?:number|null;ignore_warning?:number;tracking_enabled?:number;tracking_at?:number|null;packing_cost?:number};
export type PhysicalStock={code:string;name:string;spec:string;quantity:number|null;count_at:number|null;cost:number|null;location:string;minimum:number;note:string;updated_at:number;archived?:number;ignore_warning?:number;unit?:string};
export const PHYSICAL_UNITS=["张","贴","枚","个","件","包","卷","套","份"];
export const stockUnit=(s:PhysicalStock|undefined)=>s?.unit||"张";
export function packQuantity(p:Pick<Product,"pack">):number|null{const m=p.pack.trim().match(/^(\d+)\s*(?:贴|枚|张|个|件)?(?:\s*[\/／]\s*(?:包|份|套))?$/);const n=m?Number(m[1]):0;return Number.isSafeInteger(n)&&n>0&&n<=100000?n:null;}
export function formatUnits(values:Map<string,number>){return [...values].map(([unit,n])=>number(n)+" "+unit).join(" / ")||"—";}
export type StockRule={sales_code:string;stock_code:string;per_unit:number};
export const isPrintOnly=(p:Pick<Product,'supply_mode'>|undefined)=>p?.supply_mode==='打印定制'||p?.supply_mode==='定制订单';
// Printing SKUs remain available to orders and costing, outside warehouse stock work.
export function warehouseCatalog(products:Product[],stocks:PhysicalStock[],rules:StockRule[]){
 const printing=new Set(products.filter(isPrintOnly).map(p=>p.code)),printStocks=new Set<string>(),stockStocks=new Set<string>();
 for(const r of rules)(printing.has(r.sales_code)?printStocks:stockStocks).add(r.stock_code);
 return {products:products.filter(p=>!isPrintOnly(p)),stocks:stocks.filter(s=>!printStocks.has(s.code)||stockStocks.has(s.code))};
}
export type OrderStock={order_key:string;sales_code:string;stock_code:string;deducted_qty:number;unit?:string};
export function recipeStock(p:Product,rules:StockRule[],stocks:Map<string,PhysicalStock>):Product{
 if(isPrintOnly(p))return {...p,quantity:null,count_at:null};
 if(p.stock_mode!=="recipe")return p.tracking_enabled===0||(p.count_at??0)<(p.tracking_at??0)?{...p,quantity:null}:p;
 const components=rules.filter(r=>r.sales_code===p.code);
 const ready=p.tracking_enabled!==0&&components.length>0&&components.every(r=>stocks.get(r.stock_code)?.quantity!=null&&!stocks.get(r.stock_code)?.archived&&(stocks.get(r.stock_code)?.count_at??0)>=(p.tracking_at??0));
 const quantity=ready?Math.max(0,Math.min(...components.map(r=>Math.floor(stocks.get(r.stock_code)!.quantity!/r.per_unit)))):null;
 const priced=components.length>0&&components.every(r=>stocks.get(r.stock_code)?.cost!=null&&!stocks.get(r.stock_code)?.archived);
 return {...p,quantity,cost:p.cost_mode==='按实物自动计算'&&p.dynamic_cost?null:p.cost??(priced?components.reduce((s,r)=>s+stocks.get(r.stock_code)!.cost!*r.per_unit,0)+(p.packing_cost??0):null),unit:p.unit||"份",count_at:ready?Math.max(p.recipe_at??0,...components.map(r=>stocks.get(r.stock_code)?.count_at??0)):null};
}
export type OrderLine={historical_counted?:boolean;source_details?:string;printing_cost?:number|null;printing_allocated_cost?:number|null;printing_needs_review?:boolean;printing_status?:string;fulfillment_mode?:"stock"|"print";printing_note?:string;tracking_numbers?:string[];carrier?:string;refund_amount?:number|null;net_amount?:number|null;key:string;order_id:string;shop:string;platform:string;code:string;title:string;spec:string;quantity:number;status:string;order_time:number;amount:number|null;cost:number|null;deducted_qty?:number;review?:number;shipped_at?:number|null;source_updated_at?:number|null;shipped_qty?:number;unit_cost_snapshot?:number|null;cutoff_ack_at?:number|null;buyer_remark?:string;seller_remark?:string;remarks_available?:number|boolean;stock_items?:{stock_code:string;per_unit:number;quantity?:number}[]};
export function stockReadiness(p:Product,rules:StockRule[],stocks:Map<string,PhysicalStock>){
 if(p.supply_mode==="定制订单")return {label:"工单定制",detail:"每单核对姓名等定制内容，不参与现货盘点；需人工确认整单打印",ready:false};
 if(p.supply_mode==="打印定制")return {label:"数码打印",detail:"按打印规则核算，不参与现货盘点；需人工确认整单打印",ready:false};
 if(p.tracking_enabled===0)return {label:"仅统计销售",detail:"保留销量和成本，不盘点、不扣库存",ready:false};
 if(p.stock_mode!=="recipe"&&(p.count_at??0)<(p.tracking_at??0))return {label:"待盘点",detail:"重新启用库存后，请确认实际数量",ready:false};
 if(p.stock_mode!=="recipe")return {label:p.quantity==null?"待盘点":"已启用扣减",detail:p.quantity==null?"填写独立成品实际数量":"按独立成品库存扣减",ready:p.quantity!=null};
 const items=rules.filter(r=>r.sales_code===p.code);
 if(!items.length)return {label:"待关联",detail:"先设置每份发货用纸，再盘点实物",ready:false};
 if(items.some(r=>!stocks.has(r.stock_code)||stocks.get(r.stock_code)?.archived))return {label:"关联需修复",detail:"有纸张已移除或不存在，请核对关联",ready:false};
 const confirmed=items.filter(r=>stocks.get(r.stock_code)?.quantity!=null&&(stocks.get(r.stock_code)?.count_at??0)>=(p.tracking_at??0)).length;
 if(confirmed<items.length)return {label:confirmed?"部分待盘点":"待盘点",detail:"已确认 "+confirmed+" / "+items.length+" 种纸张；已确认纸张照常扣减",ready:false};
 return {label:"已启用扣减",detail:"按关联实物各自的起算时间扣减",ready:true};
}
export type InventoryRow={kind:"product"|"physical";code:string;name:string;spec:string;unit:string;quantity:number|null;cost:number|null;location:string;minimum:number;count_at:number|null;categories:string[];sales_codes:string[];sales_names:string[];ignore_warning?:number};
export function inventoryLedger(products:Product[],physical:PhysicalStock[],rules:StockRule[]):InventoryRow[]{
 const salesStocks=new Map<string,Set<string>>(),referenced=new Set<string>(),active=new Set<string>(),linkedStocks=new Map<string,Product[]>();
 for(const r of rules){referenced.add(r.stock_code);const stocks=salesStocks.get(r.sales_code)??new Set<string>();stocks.add(r.stock_code);salesStocks.set(r.sales_code,stocks);}
 // Resolve associations once. Scanning every rule for every product and stock
 // makes a large numeric-sheet catalogue stall the inventory screen.
 for(const p of products.filter(p=>!isPrintOnly(p)))for(const code of salesStocks.get(p.code)??[]){
  if(p.tracking_enabled!==0)active.add(code);
  if(p.stock_mode==="recipe"){const linked=linkedStocks.get(code)??[];linked.push(p);linkedStocks.set(code,linked);}
 }
 return [...physical.filter(s=>!s.archived&&(!referenced.has(s.code)||active.has(s.code))).map(s=>{
  const linked=linkedStocks.get(s.code)??[];
  return {kind:"physical" as const,code:s.code,name:s.name,spec:s.spec,unit:stockUnit(s),quantity:s.quantity,cost:s.cost,location:s.location,minimum:s.minimum,count_at:s.count_at,categories:[...new Set(linked.map(p=>p.category)),...(/cm数字贴/.test(s.name)?["数字贴内部备货"]:[]),"共用实物"],sales_codes:linked.map(p=>p.code),sales_names:linked.map(p=>p.name),ignore_warning:s.ignore_warning};
 }),...products.filter(p=>!isPrintOnly(p)&&p.stock_mode!=="recipe"&&p.tracking_enabled!==0).map(p=>({kind:"product" as const,code:p.code,name:p.name,spec:[p.spec,p.pack].filter(Boolean).join(" · "),unit:p.unit,quantity:(p.count_at??0)<(p.tracking_at??0)?null:p.quantity,cost:p.cost,location:p.location,minimum:p.minimum,count_at:p.count_at,categories:[p.category],sales_codes:[p.code],sales_names:[p.name],ignore_warning:p.ignore_warning}))];
}
export function inventoryTotals(rows:InventoryRow[]){
 const confirmed=rows.filter(r=>r.quantity!=null),byUnit=new Map<string,number>(),physicalByUnit=new Map<string,number>();
 for(const r of confirmed)byUnit.set(r.unit,(byUnit.get(r.unit)??0)+r.quantity!);
 for(const r of confirmed.filter(r=>r.kind==="physical"))physicalByUnit.set(r.unit,(physicalByUnit.get(r.unit)??0)+r.quantity!);
 return {confirmed:confirmed.length,pending:rows.length-confirmed.length,paperRows:confirmed.filter(r=>r.kind==="physical"&&r.unit==="张").length,paperQuantity:physicalByUnit.get("张")??0,physicalRows:confirmed.filter(r=>r.kind==="physical").length,physicalByUnit,byUnit,capital:confirmed.reduce((n,r)=>n+r.quantity!*(r.cost??0),0),missingCosts:confirmed.filter(r=>r.cost==null).length,low:confirmed.filter(r=>r.quantity!<=r.minimum&&!r.ignore_warning)};
}
export function inventoryExportRows(rows:InventoryRow[]){
 return [["记录类型","实物编码","名称","规格 / 版面","库存单位","实物库存数量","盘点状态","每单位成本","库位","关联销售编码","库存起算时间","预警状态"],...rows.map(r=>[r.kind==="physical"?"实物纸张":"独立成品",r.code,r.name,r.spec,r.unit,r.quantity??"",r.quantity==null?"未确认":"已确认",r.cost??"",r.location,r.sales_codes.join("；"),r.count_at?time(r.count_at):"",r.ignore_warning?"已忽略预警":"正常提醒"])];
}
export const VALID_STATUSES=["已发货","已完成"];
export const isValid=(s:string)=>VALID_STATUSES.includes(s);
export const money=(n:number|null|undefined)=>n==null?"—":"¥"+n.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
export const number=(n:number|null|undefined)=>n==null?"—":n.toLocaleString("zh-CN");
export const date=(n:number|null|undefined)=>n==null?"—":new Date(n).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"});
export const time=(n:number)=>new Date(n).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false});
export const localDateTime=(n=Date.now())=>new Date(n+8*3600000).toISOString().slice(0,16);
export function chinaTime(s:string){if(!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s))throw new Error("时间格式无法识别");const n=Date.parse(s.replace(" ","T")+"+08:00");if(!Number.isFinite(n))throw new Error("日期无效");return n;}
export function summarize(products:Product[],orders:OrderLine[],days=30,now=Date.now()){
 const start=now-days*86400000;let estimatedLines=0;const sales=new Map<string,{qty:number;last:number;cost:number;records:number}>();const groups=new Map<string,{amount:number|null;cost:number;missing:boolean}>();
 for(const o of orders){if(!isValid(o.status))continue;const x=sales.get(o.code)??{qty:0,last:0,cost:0,records:0};x.last=Math.max(x.last,o.order_time);if(o.order_time>=start){const lineCost=o.fulfillment_mode==="print"?o.printing_allocated_cost??null:o.cost??(o.unit_cost_snapshot==null?null:o.unit_cost_snapshot*o.quantity);if(o.cost==null&&lineCost!=null)estimatedLines++;x.qty+=o.quantity;x.cost+=lineCost??0;x.records++;const k=JSON.stringify([o.shop,o.order_id]);const g=groups.get(k)??{amount:null,cost:0,missing:false};if(o.amount!=null)g.amount=o.amount;g.cost+=lineCost??0;g.missing||=lineCost==null;groups.set(k,g);}sales.set(o.code,x);}
 const counted=products.filter(p=>!isPrintOnly(p)&&p.tracking_enabled!==0&&p.quantity!=null),direct=counted.filter(p=>p.stock_mode!=="recipe");let revenue=0,gross=0,revenueAvailable=groups.size>0,grossAvailable=groups.size>0;for(const g of groups.values()){if(g.amount==null)revenueAvailable=false;if(g.amount==null||g.missing)grossAvailable=false;revenue+=g.amount??0;gross+=(g.amount??0)-g.cost;}const known=new Set(products.map(p=>p.code));
 return {sales,estimatedLines,counted:counted.length,pending:products.filter(p=>!isPrintOnly(p)&&p.tracking_enabled!==0).length-counted.length,units:direct.reduce((n,p)=>n+(p.quantity??0),0),capital:direct.reduce((n,p)=>n+(p.cost??0)*(p.quantity??0),0),missingCosts:direct.filter(p=>p.cost==null).length,low:counted.filter(p=>(p.quantity??0)<=p.minimum),negative:counted.filter(p=>(p.quantity??0)<0),unknown:orders.filter(o=>isValid(o.status)&&!known.has(o.code)),reviews:orders.filter(o=>o.review===1),revenue:revenueAvailable?revenue:null,gross:grossAvailable?gross:null,validOrders:groups.size,qty:[...sales.values()].reduce((n,s)=>n+s.qty,0)};
}
