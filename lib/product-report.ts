import {inventoryLedger,isValid,isPrintOnly,recipeStock,type InventoryRow,type OrderLine,type PhysicalStock,type Product,type StockRule} from './model';
import {inventoryDemand} from './inventory-demand';

const DAY=86400000;
function orderCost(o:OrderLine,p:Product|undefined){
 if(o.fulfillment_mode==="print")return {cost:o.printing_allocated_cost??null,estimated:true};
 const unit=o.unit_cost_snapshot??p?.cost;
 return {cost:unit!=null?unit*o.quantity:o.cost,estimated:unit!=null};
}
export function reportFinancialTotals(products:Product[],orders:OrderLine[],days=30,now=Date.now()){
 const pmap=new Map(products.map(p=>[p.code,p])),groups=new Map<string,{amounts:Set<number>;cost:number;missing:boolean}>();let estimatedLines=0;
 for(const o of orders){if(!isValid(o.status)||o.order_time<now-days*DAY||o.order_time>now)continue;const k=JSON.stringify([o.shop,o.order_id]),g=groups.get(k)??{amounts:new Set<number>(),cost:0,missing:false},price=orderCost(o,pmap.get(o.code));if(o.amount!=null)g.amounts.add(o.amount);g.cost+=price.cost??0;g.missing||=price.cost==null;if(price.estimated)estimatedLines++;groups.set(k,g);}
 let revenue=0,gross=0,amountReady=groups.size>0,costReady=groups.size>0;
 for(const g of groups.values()){if(g.amounts.size!==1)amountReady=false;if(g.missing)costReady=false;const amount=[...g.amounts][0]??0;revenue+=amount;gross+=amount-g.cost;}
 return {revenue:amountReady?revenue:null,gross:amountReady&&costReady?gross:null,estimatedLines};
}
export type StockForecast=InventoryRow&{usage:number;daily:number;cover:number|null;suggested:number;warning:string|null;severity:number;blocked_codes:string[]};
export type ProductReportRow={product:Product;quantity:number;quantity30:number;quantity60:number;last:number|null;idleDays:number|null;records:number;revenue:number|null;cost:number|null;gross:number|null;margin:number|null;estimated:boolean;priceNote:string;cover:number|null;warnings:StockForecast[]};

// Demand uses sales, including sales before the first count. Deductions would
// understate demand for products only recently counted. Each shared stock is
// projected once, using the usage rules of all its active sales SKUs.
export function forecastStock(products:Product[],stocks:PhysicalStock[],rules:StockRule[],orders:OrderLine[],options:{days?:number;warningDays?:number;targetDays?:number;now?:number}={}){
 const {days=30,warningDays=7,targetDays=30,now=Date.now()}=options;
 const {sales,physical:demand}=inventoryDemand(products,rules,orders,now-days*DAY,now+1),pmap=new Map(products.map(p=>[p.code,p]));
 return inventoryLedger(products,stocks,rules).map(row=>{
  const usage=row.kind==='physical'?demand.get(row.code)??0:sales.get(row.code)??0,daily=usage/days,q=row.quantity;
  const activeRules=row.kind==='physical'?rules.filter(r=>r.stock_code===row.code&&pmap.get(r.sales_code)?.stock_mode==='recipe'&&!isPrintOnly(pmap.get(r.sales_code))&&pmap.get(r.sales_code)?.tracking_enabled!==0):[];
  const blocked_codes=q==null?[]:activeRules.filter(r=>r.per_unit>q).map(r=>r.sales_code),maxPack=Math.max(0,...activeRules.map(r=>r.per_unit));
  const cover=q==null?null:q<=0?0:daily>0?q/daily:null;
  let warning:string|null=null,severity=0;
  if(q!=null){if(q<0){warning='负库存，需核对';severity=4;}else if(q===0){warning='已缺货';severity=3;}else if(blocked_codes.length){warning='部分销售规格缺货';severity=3;}else if(q<=row.minimum){warning='库存低于预警线';severity=2;}else if(cover!=null&&cover<=warningDays){warning=`预计${warningDays}天内缺货`;severity=1;}}
  const suggested=q==null?0:Math.max(0,Math.ceil(Math.max(row.minimum,daily*targetDays,maxPack)-q)),active=row.sales_codes.map((code,i)=>({code,name:row.sales_names[i]})).filter(p=>!isPrintOnly(pmap.get(p.code))&&pmap.get(p.code)?.tracking_enabled!==0);
  return {...row,sales_codes:active.map(p=>p.code),sales_names:active.map(p=>p.name),usage,daily,cover,suggested,warning,severity,blocked_codes};
 }).sort((a,b)=>b.severity-a.severity||(a.cover??Infinity)-(b.cover??Infinity)||a.name.localeCompare(b.name,'zh-CN'));
}

export function buildProductReport(products:Product[],stocks:PhysicalStock[],rules:StockRule[],orders:OrderLine[],days=30,now=Date.now()){
 const stockMap=new Map(stocks.map(s=>[s.code,s])),pmap=new Map(products.map(p=>[p.code,recipeStock(p,rules,stockMap)]));
 const sales=new Map<string,{quantity:number;quantity30:number;quantity60:number;last:number|null;lines:OrderLine[]}>();
 const groups=new Map<string,OrderLine[]>();let earliest:number|null=null;
 for(const o of orders){if(o.order_time>now)continue;earliest=earliest==null?o.order_time:Math.min(earliest,o.order_time);const key=JSON.stringify([o.shop,o.order_id]);const group=groups.get(key)??[];group.push(o);groups.set(key,group);
  if(!isValid(o.status))continue;const s=sales.get(o.code)??{quantity:0,quantity30:0,quantity60:0,last:null,lines:[]};s.last=Math.max(s.last??0,o.order_time);
  if(o.order_time>=now-30*DAY)s.quantity30+=o.quantity;if(o.order_time>=now-60*DAY)s.quantity60+=o.quantity;
  if(o.order_time>=now-days*DAY){s.quantity+=o.quantity;s.lines.push(o);}sales.set(o.code,s);
 }
 const forecasts=forecastStock(products,stocks,rules,orders,{days,now}),fmap=new Map(forecasts.map(f=>[JSON.stringify([f.kind,f.code]),f]));
 const rows:ProductReportRow[]=products.map(original=>{
  const product=pmap.get(original.code)!,s=sales.get(original.code)??{quantity:0,quantity30:0,quantity60:0,last:null,lines:[]};
  let revenue=0,totalCost=0,missingAmount=0,missingCost=0,multi=0,estimated=false;
  const seen=new Set<string>();
  for(const o of s.lines){const k=JSON.stringify([o.shop,o.order_id]);if(!seen.has(k)){seen.add(k);const group=groups.get(k)!;
    // ERP amount is an order total. Never assign a multi-product order total
    // to one SKU, or silently overwrite inconsistent totals in different rows.
    const amounts=[...new Set(group.map(x=>x.amount).filter((v):v is number=>v!=null))];
    if(new Set(group.map(x=>x.code)).size!==1)multi++;else if(amounts.length!==1)missingAmount++;else revenue+=amounts[0];
   }
   const price=orderCost(o,product);
   if(price.cost==null)missingCost++;else{totalCost+=price.cost;estimated||=price.estimated;}
  }
  const financial=s.lines.length>0&&multi===0&&missingAmount===0&&missingCost===0;
  const linked=product.stock_mode==='recipe'?rules.filter(r=>r.sales_code===product.code).map(r=>fmap.get(JSON.stringify(['physical',r.stock_code]))):[fmap.get(JSON.stringify(['product',product.code]))];
  const complete=!isPrintOnly(product)&&product.tracking_enabled!==0&&product.quantity!=null&&linked.length>0&&linked.every(f=>f?.quantity!=null);
  const finite=linked.flatMap(f=>f?.cover!=null?[f.cover]:[]),cover=complete&&finite.length?Math.min(...finite):null;
  return {product,quantity:s.quantity,quantity30:s.quantity30,quantity60:s.quantity60,last:s.last,idleDays:s.last==null?null:Math.floor((now-s.last)/DAY),records:s.lines.length,
   revenue:s.lines.length>0&&multi===0&&missingAmount===0?revenue:null,cost:s.lines.length>0&&missingCost===0?totalCost:null,gross:financial?revenue-totalCost:null,margin:financial&&revenue>0?(revenue-totalCost)/revenue:null,estimated,
   priceNote:!s.lines.length?'周期内无销量':[multi?`${multi}笔多商品订单待分摊`:'',missingAmount?`${missingAmount}笔金额需补齐或核对`:'',missingCost?`${missingCost}条明细缺成本`:''].filter(Boolean).join('；')||(estimated?'按已设置成本估算':'按ERP商品成本计算'),cover,
   warnings:isPrintOnly(product)||product.tracking_enabled===0?[]:linked.filter((f):f is StockForecast=>!!f?.warning&&!f.ignore_warning&&(f.warning!=='部分销售规格缺货'||f.blocked_codes.includes(product.code)))};
 });
 return {rows,forecasts,earliest,historyDays:earliest==null?0:Math.floor((now-earliest)/DAY)};
}
