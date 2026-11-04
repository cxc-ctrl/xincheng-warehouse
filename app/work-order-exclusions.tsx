'use client';
import {useState} from 'react';
import type {WorkOrderExclusion} from '../lib/work-order-exclusions';
import {time} from '../lib/model';
export default function WorkOrderExclusions({rows}:{rows:WorkOrderExclusion[]}){
 const [search,setSearch]=useState(''),[page,setPage]=useState(1);
 if(!rows.length)return null;
 const filtered=rows.filter(r=>[r.shop,r.order_id,r.title].join(' ').toLowerCase().includes(search.toLowerCase())),pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages);
 return <details className="panel print-pad"><summary>工单定制 · 已忽略 {rows.length} 单</summary><p className="muted">整单不参与库存、打印、快递匹配和经营统计；重复导入继续忽略。</p><input aria-label="搜索工单定制订单" placeholder="搜索订单号、店铺或商品" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/><div className="table-scroll"><table><thead><tr><th>订单 / 店铺</th><th>商品</th><th>标签</th><th>标记时间</th></tr></thead><tbody>{filtered.slice((current-1)*20,current*20).map(r=><tr key={r.shop+r.order_id}><td><code>{r.order_id}</code><small>{r.shop}</small></td><td>{r.title}<small>{r.line_count}项商品</small></td><td><span className="badge">工单定制</span></td><td>{time(r.created_at)}</td></tr>)}</tbody></table></div><div className="table-footer"><span>共 {filtered.length} 单</span><div><button className="button secondary small" disabled={current===1} onClick={()=>setPage(current-1)}>上一页</button><span>{current} / {pages}</span><button className="button secondary small" disabled={current===pages} onClick={()=>setPage(current+1)}>下一页</button></div></div></details>;
}
