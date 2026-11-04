'use client';
import {useState} from 'react';
import PhysicalStockEditor from './physical-stock-editor';
import BatchStockSetup from './batch-stock-setup';
import ChildSkuImport from './child-sku-import';
import {stockUnit,number,type PhysicalStock,type Product,type StockRule} from '../lib/model';
import './inventory-stock-manager.css';
type Action=(body:Record<string,unknown>,message:string)=>Promise<boolean>;
export type StockManagerTarget={kind:'new'|'edit'|'restore';code?:string;initialTab?:'single'|'batch'|'excel';prefill?:string};
export function InventoryStockManager({target,stocks,products,rules,busy,onCancel,onAction}:{target:StockManagerTarget;stocks:PhysicalStock[];products:Product[];rules:StockRule[];busy:boolean;onCancel:()=>void;onAction:Action}){
 const [tab,setTab]=useState(target.initialTab??'single'),stock=stocks.find(s=>s.code===target.code)??null;
 if(target.kind!=='new'&&!stock)return <p className="muted stock-manager-missing">该库存货品已变化，请关闭后刷新库存列表。</p>;
 return <div className="stock-manager-body">{target.kind==='new'&&<div className="period-toolbar stock-manager-tabs"><button className={'period '+(tab==='single'?'active':'')} disabled={busy} onClick={()=>setTab('single')}>单个新增</button><button className={'period '+(tab==='batch'?'active':'')} disabled={busy} onClick={()=>setTab('batch')}>批量建立与关联</button><button className={'period '+(tab==='excel'?'active':'')} disabled={busy} onClick={()=>setTab('excel')}>Excel导入库存货品</button></div>}
  {target.kind!=='new'||tab==='single'?<PhysicalStockEditor stock={stock} restore={target.kind==='restore'} rules={rules} busy={busy} onCancel={onCancel} onAction={onAction}/>:tab==='batch'?<div className="stock-manager-bulk"><BatchStockSetup products={products} stocks={stocks} busy={busy} prefill={target.prefill??''} onAction={onAction}/></div>:<div className="stock-manager-bulk"><ChildSkuImport products={products} stocks={stocks} busy={busy} onAction={onAction}/></div>}
 </div>;
}
export function ArchivedInventoryStocks({stocks,rules,busy,onRestore,onAction}:{stocks:PhysicalStock[];rules:StockRule[];busy:boolean;onRestore:(stock:PhysicalStock)=>void;onAction:Action}){
 const archived=stocks.filter(s=>s.archived),[search,setSearch]=useState('');if(!archived.length)return null;
 return <details className="panel archived-inventory-stocks"><summary>已移除库存货品（{archived.length}）</summary><p className="muted">这些货品不计入当前库存，可恢复并重新盘点。历史流水继续保留。</p><input aria-label="搜索已移除库存货品" placeholder="搜索名称或库存编码" value={search} onChange={e=>setSearch(e.target.value)}/><div className="table-scroll"><table><thead><tr><th>货品 / 编码</th><th>规格</th><th>移除前记录数量</th><th>操作</th></tr></thead><tbody>{archived.filter(s=>(s.code+' '+s.name+' '+s.spec).includes(search)).map(s=><tr key={s.code}><td><strong>{s.name}</strong><code>{s.code}</code></td><td>{s.spec||'—'}</td><td>{number(s.quantity)} {stockUnit(s)}</td><td><button className="text-btn" disabled={busy} onClick={()=>onRestore(s)}>恢复并盘点</button><button className="text-btn remove-action" disabled={busy} onClick={()=>{const linked=[...new Set(rules.filter(r=>r.stock_code===s.code).map(r=>r.sales_code))];if(confirm('彻底删除“'+s.name+'”？删除后不能恢复。\n历史订单和流水保留。'+(linked.length?'\n关联的销售SKU需重新设置规则：'+linked.join('、'):'')))void onAction({action:'physical_delete',code:s.code},'货品已彻底删除，历史记录保留。');}}>彻底删除</button></td></tr>)}</tbody></table></div></details>;
}
