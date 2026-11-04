"use client";
import {useState} from "react";
import {Box,PackagePlus} from "lucide-react";
import {number,type InventoryRow} from "../lib/model";

export default function InventoryReplenish({row,busy,onSave}:{row:InventoryRow;busy:boolean;onSave:(quantity:number,note:string)=>void}){
 const [quantity,setQuantity]=useState("");
 const n=Number(quantity),valid=quantity!==""&&Number.isSafeInteger(n)&&n>0&&n<=100000000&&row.quantity!=null;
 return <form className="modal-form" onSubmit={e=>{e.preventDefault();if(busy||!valid)return;const f=new FormData(e.currentTarget);onSave(n,String(f.get("note")??""));}}>
  <div className="selected-sku"><Box size={22}/><div><strong>{row.name}</strong><code>{row.code}</code><small>{row.kind==="physical"?"实物子SKU":"独立成品"} · 当前库存 {number(row.quantity)} {row.unit}</small></div></div>
  <label>本次新增数量（{row.unit}）<input required autoFocus name="quantity" type="number" min="1" max="100000000" step="1" value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value)} placeholder="填写这次到货或生产增加的数量"/></label>
  {valid&&<div className="confirmation-box" role="status"><p>入库后预计库存：<strong>{number(row.quantity)} + {number(n)} = {number(row.quantity!+n)} {row.unit}</strong></p></div>}
  <label>入库备注<textarea name="note" maxLength={1000} disabled={busy} placeholder="例如：生产补货、采购到货、供应商批次"/></label>
  <p className="muted">本次数量会加到现有库存，并保留入库流水。{row.kind==="physical"?"关联的销售SKU共用这份实物库存，只需补货一次。":""}</p>
  <button className="button primary" disabled={busy||!valid}><PackagePlus size={17}/>{busy?"正在保存…":"确认补货入库"}</button>
 </form>;
}
