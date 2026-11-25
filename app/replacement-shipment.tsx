'use client';
import {useState} from 'react';
import {chinaTime,isPrintOnly,localDateTime,type OrderLine,type Product} from '../lib/model';
import type {Shop} from '../lib/shops';

export default function ReplacementShipment({order,products,shops=[],busy,onAction}:{order?:OrderLine;products:Product[];shops?:Shop[];busy:boolean;onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>}){
 const [shopId,setShopId]=useState(''),[orderId,setOrderId]=useState(''),[original,setOriginal]=useState(''),[quantity,setQuantity]=useState('');
 const [at,setAt]=useState(()=>localDateTime(order?.shipped_at??undefined)),[note,setNote]=useState('');
 const [allocations,setAllocations]=useState([{sku:'',quantity:String(order?.quantity??'')}]);
 const [search,setSearch]=useState('');
 const shop=shops.find(s=>s.id===shopId),total=order?.quantity??Number(quantity);
 const codes=products.filter(p=>!isPrintOnly(p)&&p.tracking_enabled!==0);
 const shown=codes.filter(p=>p.code===original||allocations.some(a=>a.sku===p.code)||[p.code,p.name,p.spec].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 const options=[...shown.slice(0,80),...shown.slice(80).filter(p=>p.code===original||allocations.some(a=>a.sku===p.code))];
 const valid=allocations.every(a=>a.sku&&Number.isSafeInteger(Number(a.quantity))&&Number(a.quantity)>0)&&allocations.reduce((n,a)=>n+Number(a.quantity),0)===total;
 return <form className="modal-form" onSubmit={async e=>{
  e.preventDefault();
  if(!valid||!order&&!shop)return;
  const identity=order?{shop:order.shop,platform:order.platform,orderId:order.order_id,sku:order.code,quantity:order.quantity}:{shop:shop!.code,platform:shop!.platform,orderId,sku:original,quantity:total};
  if(await onAction({action:'manual_outbound',order:{...identity,actual:allocations.map(a=>({...a,quantity:Number(a.quantity)}))},note,at:chinaTime(at)},'实际发货款式已登记。')){
   setOrderId('');setOriginal('');setQuantity('');setAllocations([{sku:'',quantity:''}]);setNote('');
  }
 }}>
  <p className="note-box">适用于发货前换款，或纠正已经扣错款式的订单。A 已经寄出、后来补发 B 的情况，请另办补发出库。</p>
  {!order&&<><label>订单店铺<select required value={shopId} onChange={e=>setShopId(e.target.value)}><option value="">请选择订单店铺</option>{shops.filter(s=>s.enabled).map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label><label>平台订单号<input required value={orderId} onChange={e=>setOrderId(e.target.value)}/></label></>}
  <label>搜索 SKU<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="输入商品名称、编码或规格"/></label>
  {order?<p>原订单商品 {order.code} · {order.quantity} 份</p>:<><label>原订单 SKU<select required value={original} onChange={e=>setOriginal(e.target.value)}><option value="">请选择</option>{options.map(p=><option key={p.code} value={p.code}>{p.name} · {p.code}</option>)}</select></label><label>原订单数量（份）<input required type="number" min="1" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label></>}
  {allocations.map((a,i)=><div key={i}>
   <label>实际发货 SKU<select required value={a.sku} onChange={e=>setAllocations(allocations.map((v,j)=>j===i?{...v,sku:e.target.value}:v))}><option value="">请选择实际发出的款式</option>{options.map(p=><option key={p.code} value={p.code}>{p.name} · {p.code}</option>)}</select></label>
   <label>实际发货数量（份）<input required type="number" min="1" step="1" value={a.quantity} onChange={e=>setAllocations(allocations.map((v,j)=>j===i?{...v,quantity:e.target.value}:v))}/></label>
   {allocations.length>1&&<button type="button" className="text-btn" onClick={()=>setAllocations(allocations.filter((_,j)=>i!==j))}>移除此款</button>}
  </div>)}
  <button type="button" className="text-btn" disabled={allocations.length>=20} onClick={()=>setAllocations([...allocations,{sku:'',quantity:''}])}>增加一个实际发货款式</button>
  <label>实际发货时间<input required type="datetime-local" step="1" value={at} onChange={e=>setAt(e.target.value)}/></label>
  <label>换款说明<input required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：客户确认改发 B 款"/></label>
  <button className="button primary" disabled={busy||!valid||(!order&&(!shop||!original||!orderId.trim()))}>确认实际发货款式</button>
 </form>;
}
