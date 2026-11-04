"use client";
import {useState} from "react";
import {Box, Check, LoaderCircle} from "lucide-react";
import {chinaTime, localDateTime, number, time, type Product} from "../lib/model";
import type {InventoryRow} from '../lib/model';
import type {CostSettings} from '../lib/fulfillment';
import StockCostFields,{stockCostDraft,inventoryCostPayload,type StockCostDraft} from './stock-cost-fields';

export default function InventoryConfirm({product:p,settings,row,busy,onSave}:{settings:CostSettings;row?:InventoryRow;product:Pick<Product,"code"|"name"|"quantity"|"unit"|"count_at">&{kind?:"product"|"physical";sales_codes?:string[]};busy:boolean;onSave:(quantity:number,at:number,details:Record<string,unknown>)=>void}) {
 const [useNow,setUseNow]=useState(true);
 const [at,setAt]=useState(localDateTime());
 const [draft,setDraft]=useState<StockCostDraft|null>(null),[error,setError]=useState('');
 return <form className="modal-form" onSubmit={e=>{e.preventDefault();try{const f=new FormData(e.currentTarget);onSave(Number(f.get("quantity")),useNow?Date.now():chinaTime(at),draft?inventoryCostPayload(draft):row?inventoryCostPayload(stockCostDraft(row,settings)):{});}catch(err){setError(err instanceof Error?err.message:'参数不正确');}}}>
  <div className="selected-sku"><Box size={22}/><div><strong>{p.name}</strong><code>{p.code}</code><small>{p.quantity==null?"尚未确认真实库存，订单暂不扣减":"当前库存："+number(p.quantity)+" "+p.unit}</small>{p.count_at!=null&&<small>上次起算：{time(p.count_at)}</small>}</div></div>
  <label>本次实盘数量（{p.unit}）<input required name="quantity" type="number" min="0" step="1" placeholder="输入现在实际剩余数量，零库存填0" autoFocus/></label>
  {row&&<details><summary>货品成本（可同时填写）</summary><StockCostFields settings={settings} unit={row.unit} draft={draft??stockCostDraft(row,settings)} onChange={setDraft} disabled={busy}/></details>}
  {error&&<p className="cost-error">{error}</p>}
  <label className="confirmation-choice"><input type="checkbox" checked={useNow} onChange={e=>{setUseNow(e.target.checked);setAt(localDateTime());}}/>以保存时的当前时间作为盘点截止</label>
  {!useNow&&<label>本次盘点截止时间<input required type="datetime-local" value={at} max={localDateTime()} onChange={e=>setAt(e.target.value)}/></label>}
  <div className="confirmation-box"><p>{p.kind==="physical"?`只确认这条实物库存，${p.sales_codes?.length??0} 个关联销售 SKU 自动共用并换算。按“${p.unit}”填写仓库实际剩余总数，销售包装不用分别盘点。`:"只确认这个产品。已确认的其他产品继续扣减，未确认的产品仍保留销售记录。"}填写截至该时间的实际剩余总量。同一时刻及以前的出库已包含在盘点中；之后发货才扣减。新增到货请登记采购入库。</p></div>
  <button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>}确认真实库存并开始扣减</button>
 </form>;
}
