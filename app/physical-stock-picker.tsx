"use client";
import {useEffect, useMemo, useState} from "react";
import {Search, X} from "lucide-react";
import {number, stockUnit, type PhysicalStock} from "../lib/model";
import {matchesStock,selectStockResults,quantityForResults,type StockSelection} from "../lib/stock-selection";
import {MAX_RECIPE_STOCKS} from '../lib/recipe-limits';
import "./stock-association.css";

type Props={stocks:PhysicalStock[];items:StockSelection[];onChange:(items:StockSelection[])=>void;busy:boolean;contextKey:string;suggestedSearch?:string};
const collator=new Intl.Collator('zh-CN',{numeric:true});
const PAGE_SIZE=40;

export default function PhysicalStockPicker({stocks,items,onChange,busy,contextKey,suggestedSearch=""}:Props){
 const [search,setSearch]=useState(suggestedSearch);
 const [onlySelected,setOnlySelected]=useState(false);
 const [page,setPage]=useState(1),[bulkQty,setBulkQty]=useState('1'),[error,setError]=useState('');
 useEffect(()=>{setSearch(suggestedSearch);setOnlySelected(false);setPage(1);setError('');},[contextKey,suggestedSearch]);
 const active=useMemo(()=>stocks.filter(s=>!s.archived).sort((a,b)=>collator.compare(a.name,b.name)||collator.compare(a.code,b.code)),[stocks]);
 const selected=useMemo(()=>new Map(items.map(i=>[i.stock_code,i])),[items]);
 const map=useMemo(()=>new Map(stocks.map(s=>[s.code,s])),[stocks]);
 const matched=useMemo(()=>active.filter(s=>matchesStock(s,search)),[active,search]);
 const visible=useMemo(()=>onlySelected?matched.filter(s=>selected.has(s.code)):matched,[matched,onlySelected,selected]);
 const pages=Math.max(1,Math.ceil(visible.length/PAGE_SIZE)),current=Math.min(page,pages),shown=visible.slice((current-1)*PAGE_SIZE,current*PAGE_SIZE);
 const matchedCodes=new Set(matched.map(s=>s.code)),matchedSelected=items.filter(i=>matchedCodes.has(i.stock_code));
 const act=(fn:()=>void)=>{try{fn();setError('');}catch(e){setError(e instanceof Error?e.message:'操作失败');}};
 const remove=(code:string)=>onChange(items.filter(i=>i.stock_code!==code));
 return <section className="physical-picker" aria-label="选择关联的实物库存">
  <div className="physical-picker-heading"><div><h3>勾选实际发出的实物</h3><p>可多选；每种默认扣1个库存单位，特殊数量再修改。</p></div><span className="physical-picker-count" aria-live="polite">已选 {items.length} 种</span></div>
  <div className="physical-picker-toolbar">
   <label className="physical-picker-search"><Search size={17}/><input aria-label="搜索可关联实物" placeholder="名称、编码、尺寸或数字范围" value={search} disabled={busy} onKeyDown={e=>{if(e.key==="Enter")e.preventDefault();}} onChange={e=>{setSearch(e.target.value);setPage(1);setError('');}}/></label>
   <button type="button" className="button secondary small" disabled={busy||(!search&&!onlySelected)} onClick={()=>{setSearch("");setOnlySelected(false);}}>全部实物</button>
   <button type="button" className={"button secondary small"+(onlySelected?" active":"")} aria-pressed={onlySelected} disabled={busy} onClick={()=>{setOnlySelected(!onlySelected);setSearch("");}}>只看已选</button>
  </div>
  <div className="physical-picker-bulk">
   <button type="button" className="button secondary small" disabled={busy||!matched.length} onClick={()=>act(()=>onChange(selectStockResults(items,matched)))}>全选搜索结果（{matched.length}）</button>
   <button type="button" className="text-btn" disabled={busy||!matchedSelected.length} onClick={()=>onChange(items.filter(i=>!matchedCodes.has(i.stock_code)))}>取消结果内勾选</button>
   <label>每份扣减<input aria-label="批量每份扣减数量" type="number" min="1" max="100000" step="1" value={bulkQty} disabled={busy} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}} onChange={e=>setBulkQty(e.target.value)}/></label>
   <button type="button" className="button secondary small" disabled={busy||!matchedSelected.length} onClick={()=>act(()=>onChange(quantityForResults(items,matchedCodes,bulkQty)))}>应用到结果内已选（{matchedSelected.length}）</button>
  </div>
  {error&&<p className="message error" role="alert">{error}</p>}
  <p className="physical-picker-result">找到 {visible.length} 种实物{search?` · 搜索：${search}`:""} · 改变搜索不会取消已选内容</p>
  {!!items.length&&<div className="physical-picker-selected" aria-label="已选实物">{items.map(item=>{const s=map.get(item.stock_code);return <span key={item.stock_code} className={!s||s.archived?"unavailable":""}><span>{s?.name??item.stock_code}<b> × {item.per_unit||"?"}{stockUnit(s)}</b>{(!s||Boolean(s.archived))&&"（已不可用，请取消）"}</span><button type="button" aria-label={`取消选择 ${item.stock_code}`} disabled={busy} onClick={()=>remove(item.stock_code)}><X size={14}/></button></span>;})}</div>}
  <div className="physical-picker-list" role="group" aria-label="可勾选的实物">
   {shown.map(s=>{const item=selected.get(s.code),unit=stockUnit(s);return <div className={"physical-picker-option"+(item?" selected":"")} key={s.code}>
    <label className="physical-picker-choice"><input type="checkbox" aria-label={`关联实物 ${s.name} ${s.code}`} checked={!!item} disabled={busy||(!item&&items.length>=MAX_RECIPE_STOCKS)} onChange={e=>e.target.checked?onChange([...items,{stock_code:s.code,per_unit:"1"}]):remove(s.code)}/><span><strong>{s.name}</strong><small>{s.spec||"版面未填写"}</small><code>{s.code}</code><small>库存：{s.quantity==null?"待盘点":number(s.quantity)+" "+unit}{s.location?` · ${s.location}`:""}</small></span></label>
    {item?<label className="physical-picker-quantity"><span>每份消耗</span><span><input required aria-label={`${s.code}每份消耗`} type="number" min="1" max="100000" step="1" value={item.per_unit} disabled={busy} onChange={e=>onChange(items.map(i=>i.stock_code===s.code?{...i,per_unit:e.target.value}:i))}/><span>{unit}</span></span></label>:<span className="physical-picker-default">每份扣 1 {unit}</span>}
   </div>;})}
   {!visible.length&&<div className="physical-picker-empty">{!active.length?"还没有库存货品，请到“库存管理”点击“新增库存货品”。":onlySelected?"还没有勾选实物。":"没有找到匹配货品，可清空搜索，或到“库存管理”新增库存货品。"}</div>}
  </div>
  {visible.length>PAGE_SIZE&&<div className="physical-picker-pages"><span>共{visible.length}种 · 每页{PAGE_SIZE}种 · {current}/{pages}</span><button type="button" className="button secondary small" disabled={busy||current===1} onClick={()=>setPage(current-1)}>上一页</button><button type="button" className="button secondary small" disabled={busy||current===pages} onClick={()=>setPage(current+1)}>下一页</button></div>}
  {items.length>=MAX_RECIPE_STOCKS&&<p className="physical-picker-limit">每个销售规格最多关联{MAX_RECIPE_STOCKS}种实物。</p>}
 </section>;
}
