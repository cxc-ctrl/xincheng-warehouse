import {readProductRefresh,mergeProductRefresh,type ProductRefresh} from './product-refresh';
import type {StockRule,Product,PhysicalStock,OrderLine,OrderStock} from './model';
export type AssociationRefresh={codes:string[];patches:ProductRefresh[];rules:StockRule[]};
export const ASSOCIATION_ACTIONS=new Set(['stock_rule','paper_setup','inventory_association']);
export async function readAssociationRefresh(d:D1Database,scope:string,b:Record<string,any>):Promise<AssociationRefresh>{
 const codes=[...new Set<string>([...(b.sales_codes??[]),...(b.recipes??[]).map((r:any)=>r.sales_code),...(b.groups??[]).flatMap((g:any)=>(g.links??[]).map((r:any)=>r.code)),...(b.removed??[])])];
 if(!codes.length||codes.length>20||codes.some(c=>typeof c!=='string'))throw new Error('关联更新范围无效');
 const patches=[];for(const code of codes)patches.push(await readProductRefresh(d,scope,code));
 const rules=(await d.prepare('SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code IN(SELECT value FROM json_each(?)) ORDER BY sales_code,stock_code').bind(scope,JSON.stringify(codes)).all<StockRule>()).results;
 return {codes,patches,rules};
}
type State={products:Product[];physical:PhysicalStock[];orders:OrderLine[];orderStocks:OrderStock[];movements:ProductRefresh['movements'];rules:StockRule[]};
export function mergeAssociationRefresh<T extends State>(current:T,patch:AssociationRefresh):T{
 let next=current;for(const p of patch.patches)next=mergeProductRefresh(next,p);
 const codes=new Set(patch.codes);return {...next,rules:[...current.rules.filter(r=>!codes.has(r.sales_code)),...patch.rules]};
}
