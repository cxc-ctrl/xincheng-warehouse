import {appendPaperSetup} from "./paper-setup-actions";
import {appendInventoryCount} from "./count-actions";
type Validators={str:(v:unknown,max?:number)=>string;qty:(v:unknown,allowZero?:boolean)=>number;cost:(v:unknown)=>number|null;timestamp:(v:unknown)=>number};
export async function appendSharedStock(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,v:Validators){
 const stock=b.stock??{},code=v.str(stock.code);
 if(!code)throw new Error("请选择或填写共用实物编码");
 const old=await d.prepare("SELECT unit,archived,count_at FROM physical_stocks WHERE scope=? AND code=?").bind(scope,code).first<{unit:string;archived:number;count_at:number|null}>();
 if(b.new_stock&&old)throw new Error("实物编码已存在，请选择复用已有库存");
 if(!b.new_stock&&(!old||old.archived))throw new Error("请选择正在使用的共用实物");
 if(!Array.isArray(b.links)||!b.links.length||b.links.length>20)throw new Error("请关联1～20个销售SKU");
 const at=b.confirm_count?(b.use_now===true?now:v.timestamp(b.count_at??now)):null;
 if(at!=null&&at>now+60000)throw new Error("盘点时间不能在未来");
 const quantity=b.confirm_count?v.qty(b.quantity):null;
 const recipes=b.links.map((l:Record<string,unknown>)=>({sales_code:l.code,items:[{stock_code:code,per_unit:l.per_unit}],...(Object.hasOwn(l,"cost")?{cost:l.cost,packing_cost:l.packing_cost}:{})}));
 if(at!=null&&at<now-60000){
  const codes=b.links.map((l:Record<string,unknown>)=>v.str(l.code));
  if(await d.prepare("SELECT code FROM products WHERE scope=? AND tracking_enabled=0 AND code IN ("+codes.map(()=>"?").join(",")+") LIMIT 1").bind(scope,...codes).first())throw new Error("重新启用库存的商品，请确认当前实际数量，盘点时间不能早于本次启用");
 }
 await appendPaperSetup({stocks:b.new_stock?[{...stock,quantity,count_at:at}]:[],recipes,effective_at:at??b.effective_at??old?.count_at??now},d,scope,now,rid,statements,guard,v);
 if(!b.new_stock&&at!=null){
  appendInventoryCount(d,statements,scope,code,quantity!,at,now,rid,guard,true,old!.unit);
  statements.push(d.prepare("UPDATE orders SET updated_at=? WHERE scope=? AND code IN (SELECT sales_code FROM stock_rules WHERE scope=? AND stock_code=?) AND "+guard).bind(now,scope,scope,code,scope,rid));
 }
}
