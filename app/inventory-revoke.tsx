"use client";
import {useState} from "react";
import {Box,LoaderCircle,Undo2} from "lucide-react";
import {number,time,type InventoryRow} from "../lib/model";

export default function InventoryRevoke({row,busy,onSave,onCancel}:{row:InventoryRow;busy:boolean;onSave:(reason:string)=>void;onCancel:()=>void}){
 const [reason,setReason]=useState("测试录入");
 return <form className="modal-form" onSubmit={e=>{e.preventDefault();onSave(reason.trim());}}>
  <div className="selected-sku"><Box size={22}/><div><strong>{row.name}</strong><code>{row.code}</code><small>当前记录：{number(row.quantity)} {row.unit}</small>{row.count_at!=null&&<small>盘点起算：{time(row.count_at)}</small>}</div></div>
  <p>撤销后显示“待盘点”，库存数量恢复为未知。这条库存暂停自动扣减，重新确认真实库存后，按新的盘点时间开始扣减。</p>
  <p>{row.kind==="physical"?`保留 ${row.sales_codes.length} 个销售 SKU 的关联和扣减规则。`:"保留商品资料和成本。"}历史订单、销量和库存流水都保留。</p>
  <label>撤销原因<input required maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：测试录入、数量误填、需要重新盘点" disabled={busy}/></label>
  <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onCancel}>取消</button><button className="button primary" disabled={busy||!reason.trim()}>{busy?<LoaderCircle size={16} className="spin"/>:<Undo2 size={16}/>}确认撤销，恢复待盘点</button></div>
 </form>;
}
