"use client";
import {useEffect,useState,useRef,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight,RefreshCw,Search} from 'lucide-react';
import {number,time} from '../lib/model';
import type {MovementHistory,HistoryPage} from '../lib/movement-history';
import './movement-history.css';

export default function MovementHistoryPanel({revision,onReview,snapshotExport}:{revision:unknown;onReview:(key:string)=>void;snapshotExport?:ReactNode}){
 const [draft,setDraft]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[orderPage,setOrderPage]=useState(1),[size,setSize]=useState(20),[version,setVersion]=useState(0);
 const [result,setResult]=useState<MovementHistory|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[asOf,setAsOf]=useState(()=>Date.now());
 useEffect(()=>{setAsOf(Date.now());},[revision,version]);
 const lastCriteria=useRef('');
 useEffect(()=>{
  const criteria=JSON.stringify([query,page,orderPage,size]),controller=new AbortController();setLoading(true);setError('');if(lastCriteria.current!==criteria)setResult(null);lastCriteria.current=criteria;
  const params=new URLSearchParams({q:query,page:String(page),order_page:String(orderPage),size:String(size),as_of:String(asOf)});
  void fetch('/api/warehouse/history?'+params,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   const value=await response.json() as MovementHistory&{error?:string};if(!response.ok)throw new Error(value.error||'库存流水加载失败');
   if(!controller.signal.aborted)setResult(value);
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'加载失败，请重试');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[query,page,orderPage,size,asOf]);
 function search(value:string){setDraft(value);setQuery(value.trim());setPage(1);setOrderPage(1);setAsOf(Date.now());}
 return <div className="movement-history">
  <section className="panel">
   <div className="table-toolbar history-toolbar">
   <form className="history-search" onSubmit={e=>{e.preventDefault();search(draft)}}>
    <label className="search-field"><Search size={17}/><input aria-label="搜索全部库存流水" placeholder="订单号、销售SKU、实物编码、商品名称或店铺" maxLength={160} value={draft} onChange={e=>setDraft(e.target.value)}/></label>
    <button className="button primary small" type="submit">搜索全部记录</button>
    {query&&<button className="text-btn" type="button" onClick={()=>search('')}>清空搜索</button>}
   </form>
    <label className="history-page-size">每页<select aria-label="每页流水条数" value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1)}}>{[20,50,100].map(n=><option key={n} value={n}>{n}条</option>)}</select></label>
    <div className="history-actions">{snapshotExport}<button type="button" className="button secondary small" disabled={loading} onClick={()=>setVersion(v=>v+1)}><RefreshCw size={15}/>刷新</button></div>
   </div>
   {error&&<p className="message error" role="alert">{error}<button className="text-btn" onClick={()=>setVersion(v=>v+1)}>重试</button></p>}
   {loading&&<p className="history-message" role="status">正在查询全部历史记录…</p>}
   {result?.orders&&<div className="history-audit">
    <h3>对应订单 · 全部商品核对</h3><p className="muted">搜索命中任一商品，就展示同一店铺、同一订单的全部商品。异常未扣库存明细仅作核对，不计入流水。</p>
    {result.orders.rows.map(order=><details className="history-order" key={JSON.stringify([order.shop,order.order_id])} open={result.orders!.rows.length<=3}>
     <summary><strong>{order.order_id}</strong><span>{order.shop||'未填店铺'} · {order.lines.length}项商品</span><span className={'badge '+(order.lines.some(l=>l.needs_review)?'warm':'green')}>{order.lines.filter(l=>l.needs_review).length}项待核对</span></summary>
     <div className="history-order-tools"><button className="text-btn" onClick={()=>search(order.order_id)}>查看此订单全部流水</button></div>
     <div className="table-scroll"><table><thead><tr><th>商品 / 销售SKU</th><th>ERP状态 / 购买份数</th><th>扣库存情况</th><th>当前已记录的扣减实物</th><th>核对</th></tr></thead><tbody>{order.lines.map(line=><tr key={line.key}>
      <td><strong>{line.title||line.code}</strong><code>{line.code||'未填编码'}</code><small>{line.spec}</small>{line.buyer_remark&&<small>买家：{line.buyer_remark}</small>}{line.seller_remark&&<small>卖家：{line.seller_remark}</small>}</td>
      <td>{line.erp_status}<small>购买 {number(line.quantity)} 份</small></td>
      <td><span className={'badge '+(line.needs_review?'warm':line.deductions.length?'green':'')}>{line.status}</span><small>{line.reason}</small>{line.color&&<small>{line.needs_review?'记录颜色（待核对）':'识别颜色'}：{line.color}</small>}</td>
      <td>{line.deductions.length?<ul className="history-deductions">{line.deductions.map((item,i)=><li key={item.code+':'+i}><strong>{item.name} × {number(item.quantity)} {item.unit}</strong><code>{item.code}</code><small>{item.last_at?'最近扣减：'+time(item.last_at):'未找到对应扣减时间，请查看历史流水'}</small></li>)}</ul>:<span>未发现当前扣减记录</span>}</td>
      <td><button className="text-btn" onClick={()=>onReview(line.key)}>{line.needs_review?'处理待核对':'查看订单'}</button></td>
     </tr>)}</tbody></table></div>
    </details>)}
    {!result.orders.rows.length&&<p className="history-message">没有匹配的订单商品。盘点、采购等流水仍可在下方查看。</p>}
    <HistoryPagination data={result.orders} label="订单" loading={loading} onPage={setOrderPage}/>
   </div>}
   {result&&<><div className="table-scroll"><table className="history-movements"><thead><tr><th>商品 / 实物编码</th><th>订单 / 店铺</th><th>动作</th><th className="numeric">库存变化</th><th>说明</th><th>记录时间</th></tr></thead><tbody>{result.movements.rows.map(m=><tr key={m.id}>
    <td><strong>{m.name}</strong><code>{m.code}</code>{m.sales_code&&m.sales_code!==m.code&&<small>销售SKU：{m.sales_code}</small>}</td>
    <td>{m.order_id?<><button className="text-btn" onClick={()=>search(m.order_id!)}>{m.order_id}</button><small>{m.shop||'未填店铺'}</small></>:<span>—</span>}</td>
    <td><span className="badge">{m.type}</span>{m.kind==='physical'&&<small>共用实物</small>}</td>
    <td className={'numeric '+(m.delta<0?'negative':m.delta>0?'positive':'')}>{m.type==='撤销盘点'?'恢复待盘点':`${m.delta>0?'+':''}${number(m.delta)} ${m.unit}`}</td>
    <td className="note-cell">{m.note}</td><td>{time(m.at)}{m.effective_at!=null&&m.effective_at!==m.at&&<small>生效：{time(m.effective_at)}</small>}</td>
   </tr>)}</tbody></table></div>
   {!result.movements.rows.length&&<p className="history-message">{query?'没有匹配的库存流水。请查看上方订单是否尚未扣库存。':'暂无库存流水。'}</p>}
   <HistoryPagination data={result.movements} label="流水" loading={loading} onPage={setPage}/></>}
  </section>
 </div>;
}
function HistoryPagination({data,label,loading,onPage}:{data:HistoryPage<unknown>;label:string;loading:boolean;onPage:(page:number)=>void}){
 return <div className="table-footer"><span>共 {number(data.total)} {label==='订单'?'个订单':'笔流水'} · 每页 {data.size} 条</span><div className="history-pages"><button className="text-btn" disabled={loading||data.page===1} onClick={()=>onPage(1)}>首页</button><button className="icon-btn" aria-label={label+'上一页'} disabled={loading||data.page===1} onClick={()=>onPage(data.page-1)}><ChevronLeft size={17}/></button><span>{data.page} / {data.pages}</span><button className="icon-btn" aria-label={label+'下一页'} disabled={loading||data.page>=data.pages} onClick={()=>onPage(data.page+1)}><ChevronRight size={17}/></button><button className="text-btn" disabled={loading||data.page>=data.pages} onClick={()=>onPage(data.pages)}>末页</button></div></div>;
}
