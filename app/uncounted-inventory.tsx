'use client';
import {useMemo,useState} from 'react';
import {uncountedInventory} from '../lib/uncounted-inventory';
import type {Product,PhysicalStock,StockRule,InventoryRow} from '../lib/model';
import type {DigitVariant,DigitCondition} from '../lib/digit-colors';
export default function UncountedInventory({products,stocks,rules,variants,conditions,onCount,onManage}:{products:Product[];stocks:PhysicalStock[];rules:StockRule[];variants:DigitVariant[];conditions:DigitCondition[];onCount:(row:InventoryRow)=>void;onManage:(code:string)=>void}){
 const [search,setSearch]=useState(''),[mode,setMode]=useState('all'),[page,setPage]=useState(1);
 const all=useMemo(()=>uncountedInventory(products,stocks,rules,variants,conditions),[products,stocks,rules,variants,conditions]);
 const visible=all.filter(r=>(mode==='all'||(mode==='included'?r.included:!r.included))&&[r.row.code,r.row.name,r.row.spec,...r.row.sales_codes].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 const pages=Math.max(1,Math.ceil(visible.length/30)),current=Math.min(page,pages),included=all.filter(r=>r.included).length;
 return <section className="panel"><div className="section-heading"><div><h2>未盘点总览</h2><p className="muted">现货待盘点 {included} 个 · 未纳入现货的未盘点记录 {all.length-included} 个。逐个版面展示，不隐藏打印商品关联的实物。</p></div></div>
 <p className="note-box">未盘点不等于零库存。不备货或超出备货范围的版面无需填写0；分类待核对的版面请先核对产品中心制作方式和数字贴备货条件。查看此页不会改变库存、关联或历史订单。</p>
 <div className="table-toolbar"><input aria-label="搜索全部未盘点记录" placeholder="搜索商品、数字范围或库存编码" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/><select aria-label="未盘点记录范围" value={mode} onChange={e=>{setMode(e.target.value);setPage(1)}}><option value="all">全部未盘点记录</option><option value="included">现货待盘点</option><option value="excluded">未纳入现货的记录</option></select></div>
 <div className="table-scroll"><table><thead><tr><th>实物 / 编码</th><th>版面 / 单位</th><th>分类与原因</th><th>操作</th></tr></thead><tbody>{visible.slice((current-1)*30,current*30).map(({row,included,status,reason})=><tr key={row.kind+row.code}><td><strong>{row.name}</strong><code>{row.code}</code></td><td>{row.spec}<small>库存单位：{row.unit}</small></td><td><span className="badge">{status}</span><small>{reason}</small></td><td>{included?<button className="text-btn" onClick={()=>onCount(row)}>盘点库存</button>:<button className="text-btn" onClick={()=>onManage(row.code)}>查看库存资料</button>}</td></tr>)}</tbody></table></div>
 {!visible.length&&<div className="empty">当前筛选没有未盘点记录</div>}
 <div className="table-footer"><span>共 {visible.length} 个版面 / 实物 · 每页30条</span><div><button className="text-btn" disabled={current===1} onClick={()=>setPage(current-1)}>上一页</button><span>{current} / {pages}</span><button className="text-btn" disabled={current===pages} onClick={()=>setPage(current+1)}>下一页</button></div></div></section>;
}
