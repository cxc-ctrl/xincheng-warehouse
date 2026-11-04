import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Check} from 'lucide-react';
import {MAIN_ORDER_FILTERS,EXTRA_ORDER_FILTERS,type OrderFilter} from '../lib/order-review-filters';

const reasons=[...MAIN_ORDER_FILTERS,...EXTRA_ORDER_FILTERS].filter(([id])=>!['all','valid','pending','print','unmatched'].includes(id));
export default function OrderReviewFilters({selected,counts,onChange}:{selected:OrderFilter[];counts:Record<OrderFilter,number>;onChange:(next:OrderFilter[])=>void}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const active=selected.length===1?selected[0]:null;
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 function choose(id:OrderFilter){onChange([id]);setOpen(false);trigger.current?.focus();}
 const option=([id,label]:readonly [OrderFilter,string])=><button key={id} type="button" data-order-filter={id} aria-pressed={active===id} onClick={()=>choose(id)}><Check size={14} aria-hidden="true" style={{visibility:active===id?'visible':'hidden'}}/><span>{label}</span><b>{counts[id]}</b></button>;
 return <div className="order-review-filter-area" ref={root}>
  <div className="order-primary-filters" aria-label="订单筛选">
   <button type="button" data-order-filter="all" aria-pressed={active==='all'} onClick={()=>{onChange(['all']);setOpen(false);}}>全部订单 <b>{counts.all}</b></button>
   <button ref={trigger} type="button" className="order-pending-trigger" aria-expanded={open} aria-controls="order-reason-dropdown" aria-pressed={active!=='all'&&active!=='valid'} onClick={()=>{if(!open)onChange(['pending']);setOpen(v=>!v);}}>全部待核对 <b>{counts.pending}</b><ChevronDown size={14} aria-hidden="true"/></button>
   <button type="button" data-order-filter="valid" aria-pressed={active==='valid'} onClick={()=>{onChange(['valid']);setOpen(false);}}>有效订单 <b>{counts.valid}</b></button>
  </div>
  {open&&<div className="order-reason-dropdown" id="order-reason-dropdown" role="group" aria-label="选择订单分类">
   {option(['pending','全部待核对'])}
   <div className="order-reason-group">{reasons.filter(([id])=>counts[id]>0||selected.includes(id)||['shortage','missing','unknown','spec'].includes(id)).map(option)}</div>
   <div className="order-reason-group"><small>其他订单</small>{option(['unmatched','未匹配商品'])}{option(['print','已安排打印'])}</div>
  </div>}
 </div>;
}
