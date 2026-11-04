import type {PhysicalStock, Product} from "./model";
import {MAX_RECIPE_STOCKS} from "./recipe-limits";

export type StockSelection = {stock_code: string; per_unit: string};

export function selectStockResults(items:StockSelection[],stocks:PhysicalStock[]){
 const existing=new Set(items.map(i=>i.stock_code)),fresh=stocks.filter(s=>!s.archived&&!existing.has(s.code));
 if(items.length+fresh.length>MAX_RECIPE_STOCKS)throw new Error(`所选实物将超过${MAX_RECIPE_STOCKS}种，请缩小搜索范围后全选。已有勾选保持不变。`);
 return [...items,...fresh.map(s=>({stock_code:s.code,per_unit:'1'}))];
}
export function quantityForResults(items:StockSelection[],codes:Set<string>,value:string){
 if(!/^\d+$/.test(value.trim())||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>100000)throw new Error('每份扣减数量须为1～100000的整数');
 return items.map(i=>codes.has(i.stock_code)?{...i,per_unit:String(Number(value))}:i);
}

function normalize(value: string) {
 return value.normalize("NFKC").toLowerCase().replace(/厘米|公分/g,"cm").replace(/[～~—–－]/g,"-").replace(/\s+/g,"");
}

export function matchesStock(stock: PhysicalStock, search: string) {
 const text=normalize([stock.name,stock.code,stock.spec,stock.location].join(" "));
 return search.trim().split(/\s+/).filter(Boolean).every(term=>text.includes(normalize(term)));
}

export function suggestedStockSearch(product: Product | undefined, stocks: PhysicalStock[]) {
 const dimension=[product?.spec,product?.size,product?.name].join(" ").match(/\d+(?:\.\d+)?\s*(?:cm|厘米|公分)/i)?.[0] ?? "";
 const numbered=[product?.category,product?.name].join(" ").includes("数字贴")?`${dimension} 数字贴`.trim():"";
 if(dimension&&numbered&&stocks.some(s=>!s.archived&&matchesStock(s,numbered)))return numbered;
 return dimension&&stocks.some(s=>!s.archived&&matchesStock(s,dimension)) ? dimension : "";
}

export function validStockSelection(items: StockSelection[], stocks: PhysicalStock[]) {
 const active=new Set(stocks.filter(s=>!s.archived).map(s=>s.code));
 return items.length>0&&items.length<=MAX_RECIPE_STOCKS&&new Set(items.map(i=>i.stock_code)).size===items.length&&items.every(i=>active.has(i.stock_code)&&Number.isSafeInteger(Number(i.per_unit))&&Number(i.per_unit)>0&&Number(i.per_unit)<=100000);
}
