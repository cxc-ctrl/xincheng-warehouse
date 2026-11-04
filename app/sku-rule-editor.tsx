"use client";
import {useState} from "react";
import {Check} from "lucide-react";
import {stockUnit,time,number,recipeStock,type Product,type PhysicalStock,type StockRule} from "../lib/model";
import PhysicalStockPicker from "./physical-stock-picker";
import {suggestedStockSearch,validStockSelection} from "../lib/stock-selection";
type Props={product:Product;stocks:PhysicalStock[];rules:StockRule[];busy:boolean;onBatch:()=>void;onShared:()=>void;onSave:(body:Record<string,unknown>)=>Promise<boolean>};
export default function SkuRuleEditor({product,stocks,rules,busy,onBatch,onShared,onSave}:Props){
 const old=rules.filter(r=>r.sales_code===product.code);
 const [items,setItems]=useState(()=>old.map(r=>({stock_code:r.stock_code,per_unit:String(r.per_unit)})));
 const map=new Map(stocks.map(s=>[s.code,s]));
 const [align,setAlign]=useState(true);
 const baseline=items.map(i=>map.get(i.stock_code)?.count_at).filter((n):n is number=>n!=null);
 const valid=validStockSelection(items,stocks);
 const preview=recipeStock({...product,stock_mode:"recipe"},items.map(i=>({sales_code:product.code,stock_code:i.stock_code,per_unit:Number(i.per_unit)})),map);
 return <form className="modal-form sku-association" onSubmit={e=>{e.preventDefault();if(valid&&!busy)void onSave({action:"stock_rule",sales_codes:[product.code],effective_at:align?undefined:Date.now(),items:items.map(i=>({stock_code:i.stock_code,per_unit:Number(i.per_unit)}))});}}>
  <div className="setup-step"><span>2</span><div><h2>勾选这份商品要发的实物</h2><p>{product.name} · {product.spec}<code>{product.code}</code></p></div></div>
  <button type="button" className="button secondary" disabled={busy} onClick={onShared}>48／500／1000等同款包装：一页统一关联</button>
  <div className="note-box">销售SKU不填初始库存。下面的数量是“卖1份时，每份实际消耗多少实物”；仓库实际库存只在实物资料中盘点一次。</div>
  {product.stock_mode!=="recipe"&&product.quantity!=null&&<p className="accent">该SKU原独立成品库存为{number(product.quantity)}{product.unit}。关联后停止使用这份独立库存，请核对实际实物数量后再保存。</p>}
  <PhysicalStockPicker stocks={stocks} items={items} onChange={setItems} busy={busy} contextKey={product.code} suggestedSearch={suggestedStockSearch(product,stocks)}/>
  <div className="paper-actions"><button type="button" className="text-btn" disabled={busy} onClick={onBatch}>没有合适纸张？批量建立</button></div>
  {valid&&<div className="selected-sku"><div><strong>每份实际消耗</strong><small>{items.map(i=>map.get(i.stock_code)?.name+" × "+i.per_unit+stockUnit(map.get(i.stock_code))).join("；")}</small><small>{preview.quantity==null?"有纸张未盘点，可售份数待确认":"按当前纸张余量最多可组"+number(preview.quantity)+"份；共用库存不可与其他SKU相加"}</small></div></div>}
  <label className="confirmation-choice"><input type="checkbox" checked={align} onChange={e=>setAlign(e.target.checked)}/>新关联衔接实物盘点时间{baseline.length?"："+time(Math.min(...baseline)):"（未盘点则从本次保存起算）"}</label><p className="muted">按上述起算选择扣减，已使用的相同规则保留原时间。ERP销量继续按{product.code}统计；已扣减的历史规则不能直接覆盖。</p>
  <div className="modal-actions"><span className="muted">先关联，再盘点仓库实际张数</span><button className="button primary" disabled={busy||!valid}><Check size={16}/>{busy?"保存中…":"保存库存关联"}</button></div>
 </form>;
}
