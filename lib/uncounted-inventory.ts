import {inventoryLedger,isPrintOnly,stockUnit,type Product,type PhysicalStock,type StockRule,type InventoryRow} from './model';
import type {DigitVariant,DigitCondition} from './digit-colors';
export type UncountedRow={row:InventoryRow;included:boolean;status:string;reason:string};
/** Read-only view: retain excluded stock records without enabling their deduction. */
export function uncountedInventory(products:Product[],stocks:PhysicalStock[],rules:StockRule[],variants:DigitVariant[]=[],conditions:DigitCondition[]=[]):UncountedRow[]{
 const ledger=inventoryLedger(products,stocks,rules),keys=new Set(ledger.map(r=>JSON.stringify([r.kind,r.code])));
 const result:UncountedRow[]=ledger.filter(r=>r.quantity==null).map(row=>({row,included:true,status:'现货待盘点',reason:'已纳入现货库存，尚未填写实际数量'}));
 for(const s of stocks.filter(s=>!s.archived&&s.quantity==null&&!keys.has(JSON.stringify(['physical',s.code])))){
  const links=rules.filter(r=>r.stock_code===s.code),linked=products.filter(p=>links.some(r=>r.sales_code===p.code));
  const v=variants.find(v=>v.stock_code===s.code),condition=v&&conditions.find(c=>c.color===v.color&&c.size===v.size);
  const within=!!condition&&condition.enabled===1&&v!.end>=condition.start&&v!.start<=condition.end;
  const outside=!!condition&&!within;
  const printing=linked.length>0&&linked.every(isPrintOnly);
  const status=outside?'不备货／超出范围':within?'备货范围内，分类待核对':'未纳入现货';
  const reason=(condition?`备货范围 ${condition.start}～${condition.end}${condition.enabled?'':'（已停用）'}；`:'')+(printing?'当前仅关联打印商品，未列入现货盘点': '当前关联或库存跟踪配置未纳入现货')+(within?'。备货范围与制作方式不一致，请先核对':'');
  result.push({included:false,status,reason,row:{kind:'physical',code:s.code,name:s.name,spec:s.spec,unit:stockUnit(s),quantity:null,count_at:s.count_at,cost:s.cost,location:s.location,minimum:s.minimum,categories:[],sales_codes:linked.map(p=>p.code),sales_names:linked.map(p=>p.name)}});
 }
 return result;
}
