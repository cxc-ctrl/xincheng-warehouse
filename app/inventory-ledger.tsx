"use client";
import {Fragment,useEffect,useMemo,useState} from "react";
import {Box,Download,Search,ChevronLeft,ChevronRight,Link2,Plus} from "lucide-react";
import {inventoryTotals,formatUnits,money,number,time,type InventoryRow,type StockRule,type Product} from "../lib/model";
import {inventoryDisplayGroups,visibleInventoryGroups} from "../lib/inventory-display";
import InventorySheetGroup from "./inventory-sheet-group";
import InventorySalesLinks from "./inventory-sales-links";
import ProductImages from "./product-images";
import {inventoryImageIndex} from "../lib/inventory-images";
import {inventoryKey} from "../lib/stocktake";
type Props={onLoss?:(row:InventoryRow)=>void;onPurchase?:(row:InventoryRow)=>void;rows:InventoryRow[];products:Product[];rules:StockRule[];onExport:(rows:InventoryRow[])=>void;onManageStock:(row:InventoryRow)=>void;onCount:(row:InventoryRow)=>void;onRevoke:(row:InventoryRow)=>void;onEdit:(code:string)=>void;onWarning:(row:InventoryRow,ignored:boolean)=>void;busy:boolean;initialStatus:string;edits:Record<string,string>;setEdits:React.Dispatch<React.SetStateAction<Record<string,string>>>;onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>;onError:(message:string)=>void;onMessage:(message:string)=>void;onStocktake:()=>void;onAssociate?:(row:InventoryRow)=>void;onCreateStock?:()=>void};
export default function InventoryLedger(props:Props){
 const {rows,products,rules,onExport,onManageStock,onCount,onRevoke,onEdit,onWarning,busy,initialStatus,edits,setEdits,onAction,onError,onMessage,onStocktake,onAssociate,onCreateStock}=props;
 const [search,setSearch]=useState(""),[category,setCategory]=useState("全部品类"),[status,setStatus]=useState("全部状态"),[page,setPage]=useState(1);
 useEffect(()=>{setStatus(initialStatus);setPage(1)},[initialStatus]);
 const categories=[...new Set(rows.flatMap(r=>r.categories))].sort();
 const filtered=useMemo(()=>rows.filter(r=>(category==="全部品类"||r.categories.includes(category))&&(status==="全部状态"||(status==="未确认库存"&&r.quantity==null)||(status==="已确认库存"&&r.quantity!=null)||(status==="库存预警"&&r.quantity!=null&&r.quantity<=r.minimum&&!r.ignore_warning)||(status==="已忽略预警"&&!!r.ignore_warning))&&[r.code,r.name,r.spec,r.location,...r.sales_codes,...r.sales_names].join(" ").toLowerCase().includes(search.trim().toLowerCase())),[rows,category,status,search]);
 const groups=useMemo(()=>visibleInventoryGroups(inventoryDisplayGroups(rows,products),filtered),[rows,products,filtered]);
 const imageIndex=useMemo(()=>inventoryImageIndex(rows,products,rules),[rows,products,rules]);
 const totals=inventoryTotals(filtered),pages=Math.max(1,Math.ceil(groups.length/20)),current=Math.min(page,pages),drafts=Object.values(edits).filter(value=>value!=="").length;
 return <>
  <div className="inventory-summary" aria-label="实物库存统计"><div><span>已确认共用实物</span><strong>{formatUnits(totals.physicalByUnit)}<small>{totals.physicalRows} 种 · 不同单位分别汇总</small></strong></div><div><span>已确认独立成品</span><strong>{formatUnits(inventoryTotals(filtered.filter(r=>r.kind==="product")).byUnit)}</strong></div><div><span>待盘点实物记录</span><strong>{totals.pending}<small>种</small></strong></div></div>
  <section className="panel inventory-ledger"><div className="section-heading"><div><h2>实物库存台账</h2><p className="muted">数字贴按款式、尺寸收成一行，展开后分别盘点各版面。每个版面的库存仍独立扣减。</p></div><button className="text-btn" onClick={()=>{setStatus(status==="已忽略预警"?"库存预警":"已忽略预警");setPage(1)}}>{status==="已忽略预警"?"返回低库存预警":`已忽略预警（${rows.filter(r=>r.ignore_warning).length}）`}</button></div>
   {drafts>0&&<div className="inventory-drafts" role="status">已填写 {drafts} 条尚未保存，切换筛选或收起版面会保留填写。<button className="text-btn" onClick={onStocktake}>查看全部盘点填写</button></div>}
   <div className="table-toolbar"><label className="search-field"><Search size={17}/><input aria-label="搜索实物库存" placeholder="搜索实物名称、编码、销售规格或库位" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label><select aria-label="实物品类" value={category} onChange={e=>{setCategory(e.target.value);setPage(1)}}>{["全部品类",...categories].map(c=><option key={c}>{c}</option>)}</select><select aria-label="实物盘点状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}>{["全部状态","未确认库存","已确认库存","库存预警","已忽略预警"].map(c=><option key={c}>{c}</option>)}</select>{onCreateStock&&<button className="button secondary" disabled={busy} onClick={onCreateStock}><Plus size={16}/>新增库存货品</button>}<button className="button secondary" onClick={()=>onExport(filtered)}><Download size={16}/>导出当前实物</button></div>
   <div className="table-scroll"><table className={"inventory-table"+(groups.length>0&&groups.every(group=>group.grouped)?" grouped-sheets-only":"")}>
    <colgroup><col className="col-product"/><col className="col-quantity"/><col className="col-sales"/><col className="col-cost"/><col className="col-location"/><col className="col-actions"/></colgroup>
    <thead><tr><th>货品 / 规格</th><th className="numeric">实际库存</th><th>销售规格 / 扣减规则</th><th className="numeric">单位成本</th><th>库位</th><th>操作</th></tr></thead>
    <tbody>{groups.slice((current-1)*20,current*20).map(group=>group.grouped?<tr key={group.key} className="inventory-group-row"><td colSpan={6}><InventorySheetGroup onLoss={props.onLoss} imageIndex={imageIndex} group={group} visible={group.visible} rules={rules} busy={busy} edits={edits} setEdits={setEdits} onAction={onAction} onError={onError} onMessage={onMessage} onCount={onCount} onRevoke={onRevoke} onEdit={onEdit} onManageStock={onManageStock} onWarning={onWarning} onAssociate={onAssociate} onPurchase={props.onPurchase}/></td></tr>:<Fragment key={group.key}>{group.visible.map(r=><tr key={r.kind+":"+r.code} data-inventory-kind={r.kind}>
     <td className="product-cell">
      <div className="warehouse-product-identity"><ProductImages product={{name:r.name,images:imageIndex.get(inventoryKey(r))}}/><div>
      <strong>{r.name}</strong><code>{r.code}</code>
      <div className="inventory-product-meta"><span className="badge">{r.kind==="physical"?"共用实物":"独立成品"}</span>{r.spec&&<span>{r.spec}</span>}</div>
      {r.count_at!=null&&<div className="inventory-count-time">盘点起算：<time>{time(r.count_at)}</time></div>}
      </div></div>
     </td>
     <td className="numeric inventory-stock-cell">
      {r.quantity==null?<div className="inventory-pending">待盘点<small>按{r.unit}填写总数</small></div>:<div className={"inventory-quantity"+(r.quantity<0?" negative":"")}><strong>{number(r.quantity)}</strong><span>{r.unit}</span></div>}
      {!!r.ignore_warning&&<small>已忽略预警</small>}
     </td>
     <td className="inventory-links"><InventorySalesLinks row={r} rules={rules} onEdit={onEdit} busy={busy}/>{r.kind==="physical"&&!r.code.startsWith("DIGIT-")&&onAssociate&&<button className="inventory-link-action" disabled={busy} aria-label={`管理库存关联 ${r.code}`} onClick={()=>onAssociate(r)}><Link2 size={14}/>{r.sales_codes.length?"管理关联":"关联销售规格"}</button>}</td>
     <td className="numeric inventory-cost">{money(r.cost)}{r.cost!=null&&<small>元 / {r.unit}</small>}</td>
     <td className="inventory-location">{r.location||"—"}</td>
     <td><div className="inventory-row-actions">
      <button className="inventory-count-button" disabled={busy} onClick={()=>onCount(r)}>{r.quantity==null?"确认库存":"重新盘点"}</button>
      {props.onPurchase&&<button className="inventory-purchase-button" disabled={busy} onClick={()=>props.onPurchase?.(r)}>增加采购</button>}
      <div className="inventory-secondary-actions">{r.quantity!=null&&props.onLoss&&<button className="text-btn" disabled={busy} onClick={()=>props.onLoss?.(r)}>报损出库</button>}
       {r.quantity!=null&&<button className="text-btn" disabled={busy} onClick={()=>onRevoke(r)}>撤销盘点</button>}
       {r.kind==="physical"?<button className="text-btn" disabled={busy} onClick={()=>onManageStock(r)}>管理实物</button>:<button className="text-btn" disabled={busy} onClick={()=>onEdit(r.code)}>编辑资料</button>}
       {r.ignore_warning?<button className="text-btn" disabled={busy} onClick={()=>onWarning(r,false)}>恢复预警</button>:r.quantity!=null&&r.quantity<=r.minimum?<button className="text-btn" disabled={busy} onClick={()=>onWarning(r,true)}>忽略预警</button>:null}
      </div>
     </div></td>
    </tr>)}</Fragment>)}</tbody>
   </table></div>
   {!filtered.length&&<div className="empty"><Box size={30}/><h3>没有匹配的实物库存</h3><p>共用实物请在“实物与关联”建立，销售 SKU 的可售数量不会重复计入这里。</p></div>}
   <div className="table-footer"><span>{filtered.length} 条实物记录，收为 {groups.length} 行 · 每页 20 行</span><div><button className="icon-btn" aria-label="实物上一页" disabled={current<=1} onClick={()=>setPage(current-1)}><ChevronLeft size={18}/></button><span>{current} / {pages}</span><button className="icon-btn" aria-label="实物下一页" disabled={current>=pages} onClick={()=>setPage(current+1)}><ChevronRight size={18}/></button></div></div>
  </section>
 </>;
}
