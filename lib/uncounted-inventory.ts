import {inventoryLedger,type Product,type PhysicalStock,type StockRule,type InventoryRow} from './model';
import {transparentDigitRange} from './transparent-digit-range';
import type {DigitVariant,DigitCondition} from './digit-colors';
export type UncountedRow={row:InventoryRow;included:boolean;status:string;reason:string};
/** Only warehouse stock belongs in the stocktake overview. */
export function uncountedInventory(products:Product[],stocks:PhysicalStock[],rules:StockRule[],variants:DigitVariant[]=[],conditions:DigitCondition[]=[]):UncountedRow[]{
 const ledger=inventoryLedger(products.map(p=>transparentDigitRange(p.name,conditions)?.outside?{...p,supply_mode:'打印定制'}:p),stocks,rules);
 const result:UncountedRow[]=ledger.filter(r=>r.quantity==null).map(row=>({row,included:true,status:'现货待盘点',reason:'已纳入现货库存，尚未填写实际数量'}));
 return result.filter(({row})=>{const t=transparentDigitRange(row.name,conditions);if(t&&(!t.condition.enabled||!t.range||t.range.start>t.condition.end||t.range.end<t.condition.start))return false;const v=variants.find(v=>v.stock_code===row.code),c=v&&conditions.find(c=>c.color===v.color&&c.size===v.size);return !c||!!c.enabled&&v!.start<=c.end&&v!.end>=c.start;});
}
