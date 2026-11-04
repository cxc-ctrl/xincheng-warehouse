'use client';
import {useEffect,useMemo,useState} from 'react';
import {RefreshCw,Search} from 'lucide-react';
import {clientId} from '../lib/client-id';
import type {DigitRuleExport} from '../lib/digit-rule-export';
import type {Product,PhysicalStock} from '../lib/model';

export default function DigitBoardRules(){
 const [snapshot,setSnapshot]=useState<DigitRuleExport|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [search,setSearch]=useState(''),[missingOnly,setMissingOnly]=useState(false),[page,setPage]=useState(1);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
  void (async()=>{try{
   const response=await fetch('/api/warehouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'digit_rules_export',request_id:clientId()}),signal:controller.signal});
   const result=await response.json() as {error?:string;digitRuleExport?:DigitRuleExport};
   if(!response.ok||result.digitRuleExport?.format!=='warehouse-digit-rules')throw new Error(result.error||'读取版面扣减规则失败');
   if(!controller.signal.aborted)setSnapshot(result.digitRuleExport);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'读取失败，请重试');}finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>controller.abort();
 },[revision]);
 const rows=useMemo(()=>{
  if(!snapshot)return [];
  const products=new Map((snapshot.sales_product_references as Pick<Product,'code'|'name'|'spec'|'pack'>[]).map(p=>[p.code,p])),stocks=new Map((snapshot.physical_stock_references as Pick<PhysicalStock,'code'|'name'|'unit'|'spec'>[]).map(s=>[s.code,s]));
  const variants=new Map(snapshot.digit_variants.map(v=>[v.stock_code,v]));
  const grouped=new Map<string,typeof snapshot.sales_stock_links>();
  for(const link of snapshot.sales_stock_links)grouped.set(link.sales_code,[...(grouped.get(link.sales_code)??[]),link]);
  return [...grouped].map(([code,links])=>{
   const product=products.get(code),items=links.map(link=>{const stock=stocks.get(link.stock_code),v=variants.get(link.stock_code);
    const label=stock?.name||(v?`${v.size}cm · ${v.color} · ${v.start}～${v.end}`:link.stock_code);
    return {...link,label,unit:stock?.unit||'张',variant:v,missing:!stock};
   }).sort((a,b)=>(a.variant?.size??0)-(b.variant?.size??0)||(a.variant?.start??0)-(b.variant?.start??0)||a.stock_code.localeCompare(b.stock_code));
   const missing=!product||items.some(i=>i.missing);
   return {code,product,items,missing,searchText:[code,product?.name,product?.spec,product?.pack,...items.flatMap(i=>[i.label,i.stock_code])].filter(Boolean).join(' ').toLowerCase()};
  }).sort((a,b)=>a.code.localeCompare(b.code));
 },[snapshot]);
 const terms=search.trim().toLowerCase().split(/\s+/).filter(Boolean),filtered=rows.filter(r=>(!missingOnly||r.missing)&&terms.every(t=>r.searchText.includes(t)));
 const pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages),visible=filtered.slice((current-1)*20,current*20);
 return <section className="panel digit-board-rules">
  <header><div><h2>已保存的版面扣减规则</h2><p>每个销售 SKU 卖出 1 份时，分别扣下面各版面的数量。商品清空后，保留下来的关联也会显示。</p></div><button className="button secondary" type="button" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/>{loading?'读取中…':'刷新规则'}</button></header>
  <div className="digit-board-note">商品或实物资料缺失时，仅能查看保留规则，暂不能据此正常扣库存。重新导入相同编码后再核对关联、盘点库存。销售名称和购买范围以商品资料为准，不能仅凭覆盖版面反推。</div>
  <div className="digit-board-filters"><label className="search-field"><Search size={16}/><input aria-label="搜索版面扣减规则" placeholder="搜索销售 SKU、10cm、1～6 或版面编码" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label><label className="digit-board-missing"><input type="checkbox" checked={missingOnly} onChange={e=>{setMissingOnly(e.target.checked);setPage(1)}}/>仅看资料待补齐</label><span>{filtered.length} 个销售 SKU / 共 {snapshot?.summary.sales_stock_links??0} 条关联</span></div>
  {error&&<div className="message error" role="alert">{error}</div>}
  {loading?<p role="status">正在读取已保存的规则…</p>:<>
   <div className="table-scroll"><table className="digit-board-table"><thead><tr><th>销售 SKU / 商品</th><th>每份扣减的实物版面</th><th>资料状态</th></tr></thead><tbody>{visible.map(row=><tr key={row.code}><td><strong>{row.product?.name||'商品名称待重新导入'}</strong><code>{row.code}</code>{row.product&&<small>{[row.product.spec,row.product.pack].filter(Boolean).join(' · ')}</small>}</td><td>{row.items.slice(0,3).map(item=><div className="digit-board-item" key={item.stock_code}><span>{item.label}<code>{item.stock_code}</code></span><strong>× {item.per_unit} {item.unit}</strong></div>)}{row.items.length>3&&<details><summary>展开其余 {row.items.length-3} 个版面</summary>{row.items.slice(3).map(item=><div className="digit-board-item" key={item.stock_code}><span>{item.label}<code>{item.stock_code}</code></span><strong>× {item.per_unit} {item.unit}</strong></div>)}</details>}</td><td><span className={'digit-board-status '+(row.missing?'missing':'')}>{row.missing?'资料待补齐':'资料已对应'}</span><small>{!row.product?'销售商品待导入':row.items.some(i=>i.missing)?'实物货品待导入':'仅表示资料存在，库存需盘点'}</small></td></tr>)}</tbody></table></div>
   {!filtered.length&&!error&&<p className="digit-board-empty">{rows.length?'没有匹配的规则，请调整搜索条件。':'当前没有保存的数字贴版面扣减关联。'}</p>}
   <footer><span>颜色按订单备注识别；这里展示已保存的基础版面关联。修改关联请到「实物与关联 → 多实物关联」。</span><div><button className="button secondary" type="button" disabled={current<=1} onClick={()=>setPage(current-1)}>上一页</button><span>{current} / {pages}</span><button className="button secondary" type="button" disabled={current>=pages} onClick={()=>setPage(current+1)}>下一页</button></div></footer>
  </>}
 </section>;
}
