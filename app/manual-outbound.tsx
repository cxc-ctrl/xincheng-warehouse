'use client';
import {useState} from 'react';
import {chinaTime,isPrintOnly,localDateTime,type InventoryRow,type Product} from '../lib/model';
import type {Shop} from '../lib/shops';

export default function ManualOutbound({products,rows,shops,search,busy,onAction}:{products:Product[];rows:InventoryRow[];shops:Shop[];search:string;busy:boolean;onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>}){
 const [linked,setLinked]=useState(true),[shopId,setShopId]=useState(''),[orderId,setOrderId]=useState('');
 const [sku,setSku]=useState(''),[quantity,setQuantity]=useState(''),[note,setNote]=useState(''),[operator,setOperator]=useState('');
 const [at,setAt]=useState(()=>localDateTime()),[values,setValues]=useState<Record<string,string>>({});
 const query=search.trim().toLowerCase(),matches=(v:string)=>v.toLowerCase().includes(query);
 const stock=rows.filter(r=>(r.quantity??0)>0);
 const candidates=products.filter(p=>!isPrintOnly(p)&&p.tracking_enabled!==0&&(p.stock_mode!=='recipe'||p.supply_mode!=='现货优先（按条件）'));
 const saleRows=candidates.filter(p=>p.code===sku||matches([p.code,p.name,p.spec].join(' ')));
 const shop=shops.find(s=>s.id===shopId&&s.enabled),items=stock.filter(r=>Number(values[r.kind+r.code])>0).map(r=>({kind:r.kind,code:r.code,quantity:Number(values[r.kind+r.code])}));
 return <form className="modal-form" style={{padding:24}} onSubmit={async e=>{
  e.preventDefault();
  const order=linked&&shop?{shop:shop.code,platform:shop.platform,orderId,sku,quantity:Number(quantity)}:undefined;
  if(linked&&!order)return;
  if(await onAction({action:'manual_outbound',order,items,note,operator,at:chinaTime(at)},'出库已登记，库存已扣减。')){
   setOrderId('');setSku('');setQuantity('');setNote('');setValues({});setAt(localDateTime());
  }
 }}>
  <label>出库用途<select value={linked?'order':'other'} onChange={e=>setLinked(e.target.value==='order')}><option value="order">关联销售订单</option><option value="other">领样 / 其他出库</option></select></label>
  {linked?<><p className="note-box">请选择导入订单时使用的同一店铺和销售SKU。按销售数量折算实物。同一订单有多个SKU时，请分别登记。</p>
   <label>订单店铺<select required value={shopId} onChange={e=>setShopId(e.target.value)}><option value="">请选择店铺</option>{shops.filter(s=>s.enabled).map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>
   <label>平台订单号<input required maxLength={160} value={orderId} onChange={e=>setOrderId(e.target.value)} placeholder="填写小红书或其他平台的原订单号"/></label>
   <label>销售SKU<select required value={sku} onChange={e=>setSku(e.target.value)}><option value="">搜索后选择销售SKU</option>{saleRows.slice(0,80).map(p=><option key={p.code} value={p.code}>{p.name} · {p.code}</option>)}{sku&&!saleRows.slice(0,80).some(p=>p.code===sku)&&<option value={sku}>{candidates.find(p=>p.code===sku)?.name??sku} · {sku}</option>}</select></label>
   <label>销售数量（份）<input type="number" min="1" step="1" required value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
  </>:<><p className="note-box">按仓库实物单位填写出库数量。已填写 {items.length} 项。</p>
   <div className="table-scroll"><table><thead><tr><th>仓库货品</th><th>当前库存</th><th>本次出库</th></tr></thead><tbody>{stock.filter(r=>matches([r.code,r.name,r.spec].join(' '))).slice(0,50).map(r=><tr key={r.kind+r.code}><td>{r.name}<small>{r.code}</small></td><td>{r.quantity} {r.unit}</td><td><input aria-label={r.code+'出库数量'} type="number" min="0" max={r.quantity??0} step="1" value={values[r.kind+r.code]??''} onChange={e=>setValues({...values,[r.kind+r.code]:e.target.value})}/></td></tr>)}</tbody></table></div>
  </>}
  <label>实际出库时间<input required type="datetime-local" step="1" value={at} onChange={e=>setAt(e.target.value)}/></label>
  <label>经办人<input required maxLength={100} value={operator} onChange={e=>setOperator(e.target.value)}/></label>
  <label>出库说明<textarea required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder={linked?'例如：小红书订单已发出':'例如：寄样、领用'}/></label>
  <button className="button primary" disabled={busy||(linked?!shop||!orderId.trim()||!sku||Number(quantity)<1:!items.length)}>确认手动出库</button>
 </form>;
}
