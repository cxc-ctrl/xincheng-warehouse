"use client";
import {useState} from "react";
import {Check,ChevronDown,ChevronRight,ClipboardCheck} from "lucide-react";
import {chinaTime,localDateTime,money,number,time,type InventoryRow,type StockRule,type ProductImage} from "../lib/model";
import {countBatches,inventoryKey} from "../lib/stocktake";
import {sheetRange,type InventoryDisplayGroup} from "../lib/inventory-display";
import InventorySalesLinks from "./inventory-sales-links";
import ProductImages from "./product-images";
import {inventoryGroupImages} from "../lib/inventory-images";

type Props={onLoss?:(row:InventoryRow)=>void;imageIndex:Map<string,ProductImage[]>;onPurchase?:(row:InventoryRow)=>void;group:InventoryDisplayGroup;visible:InventoryRow[];rules:StockRule[];busy:boolean;
 edits:Record<string,string>;setEdits:React.Dispatch<React.SetStateAction<Record<string,string>>>;
 onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>;onError:(message:string)=>void;onMessage:(message:string)=>void;
 onCount:(row:InventoryRow)=>void;onRevoke:(row:InventoryRow)=>void;
 onEdit:(code:string)=>void;onManageStock:(row:InventoryRow)=>void;onWarning:(row:InventoryRow,ignored:boolean)=>void;onAssociate?:(row:InventoryRow)=>void};

export default function InventorySheetGroup(props:Props){
 const {group,visible,rules,edits,setEdits}=props;
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[links,setLinks]=useState(false),[working,setWorking]=useState(false),[useNow,setUseNow]=useState(true),[at,setAt]=useState(localDateTime());
 const pending=group.rows.filter(row=>row.quantity==null).length;
 const low=group.rows.filter(row=>row.quantity!=null&&row.quantity<=row.minimum&&!row.ignore_warning).length;
 const drafts=group.rows.filter(row=>(edits[inventoryKey(row)]??"")!=="").length;
 const counting=editing||drafts>0,locked=props.busy||working;
 async function save(){
  props.onError("");let batches:ReturnType<typeof countBatches>,countAt:number;
  try{
   const ownEdits=Object.fromEntries(group.rows.map(row=>[inventoryKey(row),edits[inventoryKey(row)]??""]));
   batches=countBatches(ownEdits,group.rows);if(!batches.length)throw new Error("请填写本次实盘数量，零库存填 0。");
   countAt=useNow?Date.now():chinaTime(at);
   if(!Number.isSafeInteger(countAt)||countAt>Date.now()+60000||countAt<946684800000)throw new Error("请填写有效的库存起算时间，不能在未来。");
  }catch(error){props.onError(error instanceof Error?error.message:"盘点数量无效");return;}
  setWorking(true);let saved=0;
  try{
   for(const batch of batches){
    if(!await props.onAction({action:batch.action,count_at:countAt,items:batch.items},"已保存本批版面库存。")){
     props.onMessage(`已保存 ${saved} 种版面，未保存的填写已保留。`);return;
    }
    saved+=batch.items.length;
    setEdits(previous=>{const next={...previous};for(const key of batch.keys)delete next[key];return next;});
   }
   setEditing(false);props.onMessage(`已确认 ${saved} 种版面的真实库存，留空的版面保持原状。`);
  }finally{setWorking(false);}
 }
 return <div className={"sheet-group"+(open?" is-open":"")} data-sheet-group={group.name}>
  <div className="sheet-group-heading">
   <ProductImages product={{name:group.name,images:inventoryGroupImages(visible,props.imageIndex)}}/>
   <button className="sheet-group-toggle" type="button" aria-label={`${open?"收起":"展开"} ${group.name}`} aria-expanded={open} onClick={()=>setOpen(!open)}>
    {open?<ChevronDown size={20}/>:<ChevronRight size={20}/>}<span><strong>{group.name}</strong><small>{group.spec||"数字版面"} · 按张盘点</small></span>
   </button>
   <div className="sheet-group-status"><span>{group.rows.length} 种版面</span><span>已盘点 {group.rows.length-pending}</span><span className={pending?"accent":""}>待盘点 {pending}</span>{low>0&&<span className="accent">预警 {low}</span>}{drafts>0&&<span className="accent">未保存 {drafts}</span>}</div>
   <button className="button secondary small" disabled={locked} onClick={()=>{setOpen(true);setEditing(true);}}><ClipboardCheck size={16}/>批量盘点</button>
  </div>
  {open&&<div className="sheet-group-body">
   <div className="sheet-group-tools"><span>各版面独立记库存、独立扣减。{visible.length<group.rows.length&&`当前筛选显示 ${visible.length} / ${group.rows.length} 种。`}</span><button className="text-btn" onClick={()=>setLinks(!links)} aria-expanded={links}>{links?"收起销售关联":"查看销售关联"}</button></div>
   <div className="sheet-group-scroll"><table className="sheet-group-table"><thead><tr><th>数字版面 / 编码</th><th className="numeric">当前库存</th>{counting&&<th>本次实盘（张）</th>}<th>成本 / 库位</th>{links&&<th>销售关联</th>}<th>操作</th></tr></thead><tbody>
    {visible.map(row=><tr key={inventoryKey(row)} data-sheet-code={row.code}><td><div className="warehouse-product-identity"><ProductImages product={{name:row.name,images:props.imageIndex.get(inventoryKey(row))}}/><div><strong>{sheetRange(row)?.label||row.name}</strong><code>{row.code}</code></div></div></td><td className="numeric">{row.quantity==null?<span className="inventory-pending">待盘点</span>:<strong className={row.quantity<0?"negative":""}>{number(row.quantity)} <small>张</small></strong>}{row.count_at!=null&&<small title={time(row.count_at)}>起算：{time(row.count_at)}</small>}{!!row.ignore_warning&&<small>已忽略预警</small>}</td>
     {counting&&<td><div className="qty-input"><input type="number" min="0" max="100000000" step="1" disabled={locked} aria-label={`${row.code} 本次实盘数量`} placeholder="留空不修改" value={edits[inventoryKey(row)]??""} onChange={event=>setEdits(previous=>({...previous,[inventoryKey(row)]:event.target.value}))}/><span>张</span></div></td>}
     <td>{money(row.cost)}{row.cost!=null&&<small>元 / 张</small>}<small>{row.location||"库位未填写"}</small></td>{links&&<td><InventorySalesLinks row={row} rules={rules} onEdit={props.onEdit} busy={locked}/></td>}
     <td><div className="sheet-row-actions">{props.onAssociate&&!row.code.startsWith("DIGIT-")&&<button className="text-btn" disabled={locked} aria-label={`管理库存关联 ${row.code}`} onClick={()=>props.onAssociate?.(row)}>关联</button>}<button className="text-btn" disabled={locked} onClick={()=>props.onCount(row)}>{row.quantity==null?"盘点":"重盘"}</button>{props.onPurchase&&<button className="text-btn" disabled={locked} onClick={()=>props.onPurchase?.(row)}>增加采购</button>}<div className="sheet-secondary-actions">{row.quantity!=null&&props.onLoss&&<button className="text-btn" disabled={locked} onClick={()=>props.onLoss?.(row)}>报损出库</button>}<button className="text-btn" disabled={locked} onClick={()=>props.onManageStock(row)}>管理实物</button>{row.quantity!=null&&<button className="text-btn" disabled={locked} onClick={()=>props.onRevoke(row)}>撤销盘点</button>}{row.ignore_warning?<button className="text-btn" disabled={locked} onClick={()=>props.onWarning(row,false)}>恢复预警</button>:row.quantity!=null&&row.quantity<=row.minimum?<button className="text-btn" disabled={locked} onClick={()=>props.onWarning(row,true)}>忽略预警</button>:null}</div></div></td>
    </tr>)}
   </tbody></table></div>
   {counting&&<form className="sheet-count-footer" onSubmit={event=>{event.preventDefault();void save();}}>
    <div className="sheet-count-timing"><label className="confirmation-choice"><input type="checkbox" checked={useNow} disabled={locked} onChange={event=>{setUseNow(event.target.checked);setAt(localDateTime());}}/>按本次保存时间起算</label>{!useNow&&<label>本组库存起算时间<input required type="datetime-local" disabled={locked} value={at} max={localDateTime()} onChange={event=>setAt(event.target.value)}/></label>}<small>留空保持原状；填 0 确认零库存。只保存本组已填写的版面。</small></div>
    <div className="sheet-count-save">{drafts>0&&<button type="button" className="text-btn" disabled={locked} onClick={()=>setEdits(previous=>{const next={...previous};for(const row of group.rows)delete next[inventoryKey(row)];return next;})}>清空本组填写</button>}<button type="button" className="text-btn" disabled={locked} onClick={()=>{setEditing(false);if(drafts)setOpen(false);}}>{drafts?"稍后继续":"退出批量盘点"}</button><button className="button primary" disabled={locked||!drafts}><Check size={16}/>{working?"正在保存…":`保存本次盘点${drafts?`（${drafts}）`:""}`}</button></div>
   </form>}
  </div>}
 </div>;
}
