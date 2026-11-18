import {isPrintOnly,stockUnit,type Product,type PhysicalStock,type StockRule} from './model';
import {stockIdentity,stockSize} from './stock-identity';
import {salesPack,numericSticker} from './inventory-association';

// Read-only: balances can overlap because the original counts were of the same
// goods. Deliberately provide no computed "merged balance".
export function duplicateStockPreview(products:Product[],stocks:PhysicalStock[],rules:StockRule[]){
 const groups=new Map<string,Product[]>();
 const byStock=new Map(stocks.map(s=>[s.code,s])),bySales=new Map<string,StockRule[]>(),salesByStock=new Map<string,string[]>();
 for(const r of rules){bySales.set(r.sales_code,[...(bySales.get(r.sales_code)||[]),r]);salesByStock.set(r.stock_code,[...(salesByStock.get(r.stock_code)||[]),r.sales_code]);}
 for(const p of products){
  if(!p.source_product||isPrintOnly(p)||p.supply_mode!=='现货'||p.tracking_enabled===0||numericSticker(p)||!p.size||!p.material||!salesPack(p)||/任选|自选|混选|随机|混合|混装|组合|套装/.test(p.name))continue;
  const links=bySales.get(p.code)||[];if(links.length!==1||links[0].per_unit!==salesPack(p))continue;
  const stock=byStock.get(links[0].stock_code);if(!stock||stock.archived)continue;
  if(stock.spec&&!/^同款包装共用[；;]/.test(stock.spec)&&stockSize(stock.spec)!==stockSize(p.size))continue;
  const key=stockIdentity({product_id:p.source_product,sku:p.code,name:p.name,size:p.size,material:p.material,pack_unit:stockUnit(stock),category:p.category});
  groups.set(key,[...(groups.get(key)||[]),p]);
 }
 return [...groups].flatMap(([key,members])=>{
  const codes=[...new Set(members.map(p=>bySales.get(p.code)![0].stock_code))],sales=new Set(members.map(p=>p.code));
  if(codes.length<2)return [];
  const other=codes.some(code=>salesByStock.get(code)?.some(sku=>!sales.has(sku)));
  return [{key,name:members[0].product_name||members[0].name,stocks:codes.map(code=>({stock:byStock.get(code)!,products:members.filter(p=>bySales.get(p.code)![0].stock_code===code)})),blocked:other}];
 });
}
