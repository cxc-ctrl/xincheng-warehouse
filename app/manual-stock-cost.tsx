"use client";
import {useState} from 'react';
import {money,time,type OrderLine} from '../lib/model';
import {manualStockCost,stockCostBasis} from '../lib/manual-stock-cost';
export default function ManualStockCost({order,busy,onAction}:{order:OrderLine;busy:boolean;onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>}){
 const [cost,setCost]=useState(order.manual_stock_cost_cents==null?'':String(order.manual_stock_cost_cents/100)),[zero,setZero]=useState(false);
 const saved=manualStockCost(order);
 return <details className="print-transfer-section"><summary>现货成本人工填写{saved===null?' · 成本待复核':saved!==undefined?' · 人工成本已确认':''}</summary>
 <form onSubmit={e=>{e.preventDefault();void onAction({action:'manual_stock_cost',key:order.key,basis:stockCostBasis(order),cost_at:order.manual_stock_cost_at??0,cost,note:order.manual_stock_cost_note??'',confirm_zero:zero},'本条商品已提交人工核算，成本已计入；可在“已人工核算”中查看。');}}>
 <p>仅填写本条商品的货品总成本，包含全部 {order.quantity} 份；不含快递费、打包人工费。同单其他商品单独填写，不改变库存扣减。提交后，本条未匹配明细转入“已人工核算”。</p>
 {saved!==undefined&&<p className={saved===null?'message error':'note-box'}>{saved===null?'数量、规格或备注已变化，请重新确认成本。':`已确认 ${money(saved)}`} · {order.manual_stock_cost_operator} · {time(order.manual_stock_cost_at??0)}</p>}
 <label>本条商品总成本（元）<input required type="number" min="0" max="100000000" step="0.01" value={cost} disabled={busy} onChange={e=>{setCost(e.target.value);setZero(false);}} placeholder="例如：2份合计6元，填写6"/></label>
 {cost!==''&&Number(cost)===0&&<label><input type="checkbox" checked={zero} onChange={e=>setZero(e.target.checked)}/>确认本条商品成本确实为0元</label>}
 <button className="button primary" disabled={busy||cost===''||(Number(cost)===0&&!zero)}>提交成本并完成核算</button>
 </form></details>;
}
