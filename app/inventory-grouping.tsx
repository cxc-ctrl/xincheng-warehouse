"use client";
import {useMemo,useState} from "react";
import {Layers,Download} from "lucide-react";
import {inventoryGrouping,type InventoryGroup} from "../lib/inventory-grouping";
import type {Product,PhysicalStock,StockRule,OrderLine} from "../lib/model";

type Props={products:Product[];physical:PhysicalStock[];rules:StockRule[];orders:OrderLine[];busy:boolean;progress:string;onApply:(groups:InventoryGroup[])=>Promise<void>;onExport:(rows:(string|number)[][])=>void};
export default function InventoryGrouping(props:Props){
 const [open,setOpen]=useState(false),[search,setSearch]=useState("");
 const plan=useMemo(()=>inventoryGrouping(props),[props.products,props.physical,props.rules,props.orders]);
 const shown=plan.groups.filter(g=>(g.prefix+g.name+g.links.map(l=>l.code).join(" ")).toLowerCase().includes(search.toLowerCase()));
 function exportPlan(){props.onExport([["处理","货品编码","货品名称","销售SKU编码","每份扣减数量","库存单位","说明"],...plan.groups.flatMap(g=>g.links.map(l=>["可整理",g.stock_code,g.name,l.code,l.per_unit,g.unit,"盘点总数一次；原销售成本保留"])),...plan.issues.flatMap(i=>i.codes.map(code=>["待核对",i.prefix,"",code,"","",i.reason]))]);}
 return <section className="grouping-panel panel" aria-label="按款式整理库存">
  <div className="grouping-heading"><div><h2><Layers size={18}/>批量建立库存并关联</h2><p className="muted">同款式、尺寸、材质的不同包装共用库存；单个规格也可建档。实际数量留待盘点。</p></div><button className="button secondary small" disabled={props.busy} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?"收起整理清单":plan.groups.length?`预览批量关联（${plan.groups.length}款）`:`查看待核对（${plan.issues.length}组）`}</button></div>
  {props.progress&&<p className="grouping-status" role="status">{props.progress}</p>}
  {(open||props.busy&&!!props.progress)&&<div className="grouping-body">
   {plan.groups.length?<p className="grouping-summary">可将 <strong>{plan.groups.reduce((n,g)=>n+g.links.length,0)}</strong> 个销售规格整理为 <strong>{plan.groups.length}</strong> 条货品，减少 <strong>{plan.reduction}</strong> 条盘点记录。生成后填写每款的实际总数。</p>:<p className="grouping-summary">当前没有可直接建立的库存。若还有待关联商品，请查看下方待核对原因。</p>}
   <div className="table-toolbar">{!!plan.groups.length&&<input aria-label="搜索整理款式" placeholder="搜索款式或编码" value={search} onChange={e=>setSearch(e.target.value)}/>}<button className="button secondary small" onClick={exportPlan}><Download size={15}/>导出整理清单</button>{!!plan.groups.length&&<button className="button primary" disabled={props.busy||!shown.length} onClick={()=>void props.onApply(shown)}>确认建立并关联 {shown.length} 款</button>}</div>
   {!!plan.groups.length&&<div className="table-scroll grouping-preview"><table><thead><tr><th>将建立的实物库存</th><th>销售规格 → 每卖1份扣减</th><th>总库存</th></tr></thead><tbody>{shown.slice(0,25).map(g=><tr key={g.prefix}><td><strong>{g.name}</strong><code>{g.stock_code}</code>{g.spec&&<small>{g.spec}</small>}</td><td>{g.links.map(l=><small key={l.code}>{l.code} → {l.per_unit} {g.unit}</small>)}</td><td>待盘点（{g.unit}）</td></tr>)}</tbody></table>{shown.length>25&&<p className="muted">显示前25款，其余可通过搜索或导出查看。</p>}</div>}
   {!!plan.issues.length&&<details className="grouping-issues"><summary>{plan.issues.length} 组需核对，暂保留当前库存方式</summary><ul>{plan.issues.map(i=><li key={i.prefix+JSON.stringify(i.codes)}><code>{i.prefix}</code>：{i.reason}</li>)}</ul></details>}
   <p className="muted">混合款、资料冲突和数字贴需单独核对；数码打印、工单定制不参与本次关联。销售编码、销量和每份成本继续分别保留；未盘点的库存保持待确认。</p>
  </div>}
 </section>;
}
