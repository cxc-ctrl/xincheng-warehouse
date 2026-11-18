"use client";
import {useMemo,useState} from 'react';
import {duplicateStockPreview} from '../lib/duplicate-stock-preview';
import {number,time,stockUnit,type Product,type PhysicalStock,type StockRule} from '../lib/model';
export default function DuplicateStockPreview(props:{products:Product[];stocks:PhysicalStock[];rules:StockRule[]}){
 const groups=useMemo(()=>duplicateStockPreview(props.products,props.stocks,props.rules),[props.products,props.stocks,props.rules]);
 const [open,setOpen]=useState(false);
 if(!groups.length)return null;
 return <section className="panel grouping-panel" aria-label="重复实物库存合并预览"><div className="grouping-heading"><div><h2>重复实物库存核对</h2><p className="muted">同款不同包装已分别建立库存。先核对实物总数，再整理关联；现有数量不会自动相加。</p></div><button className="button secondary small" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'收起合并预览':`查看合并预览（${groups.length}组）`}</button></div>{open&&<div className="grouping-body">{groups.map(g=><details key={g.key} open><summary>{g.name} · {g.stocks.length} 条实物库存</summary><div className="table-scroll"><table><thead><tr><th>当前实物</th><th>当前库存 / 盘点起算时间</th><th>销售规格 / 每份含量</th></tr></thead><tbody>{g.stocks.map(({stock:s,products})=><tr key={s.code}><td>{s.name}<code>{s.code}</code><small>{s.spec}</small></td><td>{number(s.quantity)} {stockUnit(s)}<small>{s.count_at==null?'尚未盘点':time(s.count_at)}</small></td><td>{products.map(p=><small key={p.code}>{p.name}<code>{p.code} · {p.pack}</code></small>)}</td></tr>)}</tbody></table></div><p className="muted">{g.blocked?'有其他款式共用上述库存，需要逐项核对关联。':'请仓库确认这些记录是否为同一批实物，并提供当前实际总库存。'}已有盘点和扣减的库存保留历史记录，确认前继续按原关联扣减。</p></details>)}</div>}</section>;
}
