import {inventoryGrouping,groupToken} from "./inventory-grouping";
import {appendPaperSetup} from "./paper-setup-actions";
import {supplyProducts} from './product-supply-view';
import type {Product,PhysicalStock,StockRule} from "./model";

type Validators=Parameters<typeof appendPaperSetup>[7];
export async function appendInventoryGrouping(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,v:Validators){
 if(!Array.isArray(b.groups)||!b.groups.length||b.groups.length>20)throw new Error("每批最多整理20个款式");
 const selected=b.groups.map((g:Record<string,unknown>)=>({prefix:v.str(g.prefix),token:v.str(g.token,20000)}));
 if(new Set(selected.map(g=>g.prefix)).size!==selected.length)throw new Error("款式重复");
 const [products,physical,rules,orders]=await Promise.all([
  d.prepare("SELECT * FROM products WHERE scope=?").bind(scope).all<Product>(),
  d.prepare("SELECT * FROM physical_stocks WHERE scope=?").bind(scope).all<PhysicalStock>(),
  d.prepare("SELECT * FROM stock_rules WHERE scope=?").bind(scope).all<StockRule>(),
  d.prepare("SELECT DISTINCT code,deducted_qty FROM orders WHERE scope=? AND deducted_qty>0").bind(scope).all<{code:string;deducted_qty:number}>()
 ]);
 const enriched=await supplyProducts(d,scope,products.results);
 const plan=inventoryGrouping({products:enriched,physical:physical.results,rules:rules.results,orders:orders.results});
 const groups=selected.map(s=>{const g=plan.groups.find(g=>g.prefix===s.prefix);if(!g||groupToken(g)!==s.token)throw new Error("商品资料或库存已变化，请刷新整理预览："+s.prefix);return g;});
 if(groups.reduce((n,g)=>n+g.links.length,0)>20)throw new Error("每批最多关联20个销售SKU");
 const codes=groups.flatMap(g=>g.links.map(l=>l.code));
 // Recheck counts inside the atomic batch so a concurrent stocktake cannot be erased.
 for(const code of codes){
  const p=enriched.find(p=>p.code===code)!;
  statements.push(d.prepare(`SELECT CASE WHEN ${guard} AND (
   NOT EXISTS(SELECT 1 FROM products WHERE scope=? AND code=? AND updated_at=? AND quantity IS NULL AND count_at IS NULL AND tracking_enabled<>0)
   OR EXISTS(SELECT 1 FROM stock_rules WHERE scope=? AND sales_code=?)
   OR EXISTS(SELECT 1 FROM orders WHERE scope=? AND code=? AND deducted_qty>0)
   OR EXISTS(SELECT 1 FROM order_stocks WHERE scope=? AND sales_code=? AND deducted_qty>0)
   OR COALESCE((SELECT updated_at FROM product_supply_profiles WHERE scope=? AND code=?),0)<>?
  ) THEN json('Inventory changed; refresh grouping') ELSE 1 END`).bind(scope,rid,scope,code,p.updated_at,scope,code,scope,code,scope,code,scope,code,p.synced_at??0));
 }
 await appendPaperSetup({stocks:groups.map(g=>({code:g.stock_code,name:g.name,spec:g.spec,unit:g.unit,quantity:null,cost:null,minimum:0,note:"按款式整理：实际总数待盘点"})),recipes:groups.flatMap(g=>g.links.map(l=>({sales_code:l.code,items:[{stock_code:g.stock_code,per_unit:l.per_unit}]}))),effective_at:now},d,scope,now,rid,statements,guard,v);
 for(const g of groups)statements.push(d.prepare("INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT ?,?,?,'physical','按款式整理',0,?,?,?,? WHERE "+guard).bind(scope,crypto.randomUUID(),g.stock_code,"原销售编码保留；每份扣减："+g.links.map(l=>l.code+"="+l.per_unit+g.unit).join("；"),now,rid,g.unit,scope,rid));
}
