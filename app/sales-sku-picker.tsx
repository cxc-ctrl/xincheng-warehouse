"use client";
import {useMemo,useState} from "react";
import {ChevronDown,ChevronUp,Plus,Search,X} from "lucide-react";
import type {Product} from "../lib/model";
import "./sales-sku-picker.css";

type Props={products:Product[];addedCodes:string[];suggestedQuery:string;busy:boolean;onAdd:(items:Product[])=>boolean};
const LIMIT=20;

export default function SalesSkuPicker({products,addedCodes,suggestedQuery,busy,onAdd}:Props){
 const [query,setQuery]=useState(""),[open,setOpen]=useState(false),[checked,setChecked]=useState<string[]>([]);
 const added=new Set(addedCodes),pending=checked.filter(code=>!added.has(code)),remaining=Math.max(0,LIMIT-added.size);
 const selected=new Set(pending),lookup=new Map(products.map(p=>[p.code,p]));
 const results=useMemo(()=>{
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return products.filter(p=>{const text=[p.code,p.name,p.category,p.spec,p.size,p.pack].join(" ").toLocaleLowerCase();return terms.every(term=>text.includes(term));});
 },[products,query]);
 const additional=results.filter(p=>!added.has(p.code)&&!selected.has(p.code));
 const canSelectAll=additional.length>0&&pending.length+additional.length<=remaining;
 const visible=results.slice(0,100);
 function addSelected(){
  const items=pending.map(code=>lookup.get(code)).filter((p):p is Product=>!!p);
  if(!busy&&items.length&&items.length<=remaining&&onAdd(items))setChecked([]);
 }
 return <div className="sales-sku-picker">
  <label className="sku-picker-label">搜索并多选销售规格
   <div className="sku-picker-search"><Search size={17} aria-hidden="true"/><input aria-label="搜索并多选销售规格" value={query} placeholder="输入编码、名称或尺寸，搜索一次后连续勾选" onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();setOpen(true);}if(e.key==="Escape"){e.preventDefault();setOpen(false);}}}/></div>
  </label>
  <div className="sku-picker-tools">
   <button type="button" className="button secondary small" aria-expanded={open} aria-controls="sales-sku-options" onClick={()=>setOpen(!open)}>{open?<ChevronUp size={16}/>:<ChevronDown size={16}/>} {open?"收起选择":"展开多选列表"}</button>
   <button type="button" className="button secondary small" disabled={busy||!suggestedQuery} onClick={()=>{setQuery(suggestedQuery);setOpen(true);}}>识别已录入的销售规格</button>
   <span>已添加 {added.size} / {LIMIT} 个；每次最多关联 {LIMIT} 个 SKU</span>
  </div>
  {open&&<div id="sales-sku-options" className="sku-picker-panel">
   <div className="sku-picker-result-tools"><span>找到 {results.length} 个销售规格</span><button type="button" className="text-btn" disabled={busy||!canSelectAll} onClick={()=>setChecked([...pending,...additional.map(p=>p.code)])}>全选搜索结果</button></div>
   {additional.length+pending.length>remaining&&<p className="sku-picker-hint">全部勾选会超过 {LIMIT} 个，请缩小搜索范围或逐项勾选。</p>}
   <div className="sku-picker-options" role="group" aria-label="销售规格搜索结果">
    {visible.map(p=>{const exists=added.has(p.code),isChecked=exists||selected.has(p.code);return <label className={"sku-picker-option"+(isChecked?" is-selected":"")} key={p.code}>
     <input type="checkbox" aria-label={"勾选销售规格 "+p.code} checked={isChecked} disabled={busy||exists||(!isChecked&&pending.length>=remaining)} onChange={e=>setChecked(e.target.checked?[...pending,p.code]:pending.filter(c=>c!==p.code))}/>
     <span className="sku-picker-product"><strong>{p.name}</strong><code>{p.code}</code><small>{[p.spec||p.size,p.pack].filter(Boolean).join(" · ")||"包装含量待填写"}</small></span>
     {exists&&<span className="badge">已添加</span>}
    </label>;})}
    {!results.length&&<p className="sku-picker-empty">没有找到匹配的销售规格，请换个名称或编码搜索。</p>}
   </div>
   {results.length>visible.length&&<p className="sku-picker-hint">当前显示前 {visible.length} 条，请输入更完整的编码或名称缩小范围。</p>}
  </div>}
  {pending.length>0&&<div className="sku-picker-selected" aria-label="待添加的销售规格">{pending.map(code=><button type="button" className="sku-picker-chip" disabled={busy} key={code} aria-label={"取消勾选 "+code} onClick={()=>setChecked(pending.filter(c=>c!==code))}>{code}<X size={13}/></button>)}</div>}
  <div className="sku-picker-footer"><span role="status">已勾选 {pending.length} 个，添加后可逐项修改每份含量。</span><div><button type="button" className="text-btn" disabled={busy||!pending.length} onClick={()=>setChecked([])}>清空勾选</button><button type="button" className="button primary small" disabled={busy||!pending.length||pending.length>remaining} onClick={addSelected}><Plus size={16}/>添加已选（{pending.length}）</button></div></div>
 </div>;
}
