"use client";
import {useRef,useState} from "react";
import {Download,Upload,Check} from "lucide-react";
import {chinaTime,localDateTime,number,time,type Product,type PhysicalStock} from "../lib/model";
import {parseChildImport,previewChildImport,childImportBatches,type ChildImport} from "../lib/child-sku-import";
import {clientId} from "../lib/client-id";
import "./child-sku-import.css";
type Props={products:Product[];stocks:PhysicalStock[];busy:boolean;onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>;initialImport?:{input:ChildImport;filename:string};onBack?:()=>void};
export default function ChildSkuImport({products,stocks,busy,onAction,initialImport,onBack}:Props){
 const fileRef=useRef<HTMLInputElement>(null),[input,setInput]=useState<ChildImport|null>(initialImport?.input??null),[filename,setFilename]=useState(initialImport?.filename??""),[error,setError]=useState(""),[working,setWorking]=useState(false),[confirmed,setConfirmed]=useState(false),[at,setAt]=useState(localDateTime()),[page,setPage]=useState(0),[stockPage,setStockPage]=useState(0),[message,setMessage]=useState("");
 const [run,setRun]=useState<{id:string;batches:ChildImport[];countAt:number;next:number}|null>(null);
 const locked=busy||working,preview=input?previewChildImport(input,products,stocks):null;
 const stockMap=new Map(preview?.children.map(s=>[s.code,s])??[]),productMap=new Map(products.map(p=>[p.code,p]));
 async function read(file:File){
  setWorking(true);setError("");setInput(null);setRun(null);setConfirmed(false);setMessage("");setPage(0);setStockPage(0);
  try{setInput(await parseChildImport(file));setFilename(file.name);}catch(e){setError(e instanceof Error?e.message:"表格读取失败");}finally{setWorking(false);}
 }
 async function save(){
  if(!input||!preview||preview.errors.length||!confirmed||locked)return;
  setWorking(true);setError("");
  try{
   const countAt=run?.countAt??chinaTime(at);if(countAt>Date.now()+60000)throw new Error("盘点时间不能在未来");
   const task=run??{id:clientId(),batches:childImportBatches(input),countAt,next:0};setRun(task);
   for(let i=task.next;i<task.batches.length;i++){
    const b=task.batches[i];
    if(!await onAction({action:"child_sku_import",request_id:task.id+":"+i,stocks:b.stocks,recipes:b.recipes,count_at:task.countAt},`子SKU导入：已完成 ${i+1}/${task.batches.length} 批`)){
     setMessage(`已完成 ${i} 批，共 ${task.batches.length} 批。处理页面上方的错误后，可继续剩余批次。`);return;
    }
    task.next=i+1;setRun({...task});
   }
   setMessage(`导入完成：${input.recipes.length} 个销售SKU、${input.stocks.length} 种实物子SKU、${input.rows} 条扣减关系。已盘点的库存保持原值，未填写数量的实物仍待盘点。`);setInput(null);setRun(null);setConfirmed(false);
  }catch(e){setError(e instanceof Error?e.message:"导入失败");}finally{setWorking(false);}
 }
 function pager(index:number,total:number,set:(n:number)=>void){return total>20?<div className="child-import-pages"><button className="button secondary small" disabled={index===0} onClick={()=>set(index-1)}>上一页</button><span>{index+1} / {Math.ceil(total/20)}</span><button className="button secondary small" disabled={(index+1)*20>=total} onClick={()=>set(index+1)}>下一页</button></div>:null;}
 return <section className="panel child-import">
  <div className="section-heading"><div><h2>用Excel设置子SKU与库存</h2><p className="muted">一行填一个对应关系：卖哪个SKU，发哪种实物，扣几个。</p></div><a className="button secondary" href="/templates/子SKU库存关联模板.xlsx" download><Download size={17}/>下载填写模板</a></div>
  <div className="child-import-body">
   {onBack&&<button className="text-btn" disabled={locked} onClick={onBack}>返回新品资料导入</button>}
   <div className="child-import-guide"><strong>先填表，再核对，最后导入</strong><p>销售SKU编码使用ERP商家编码。子SKU编码代表仓库实际货品，例如“红色15cm数字贴1–2”。一个销售SKU要发5种纸张，就填写5行。</p><p>同一子SKU的真实库存只填一次，其他行留空；重复填写相同数量也只记一次。每份扣减数量单独填写，不能用仓库总数代替。</p></div>
   <div className="child-import-controls"><button className="button primary" disabled={locked} onClick={()=>fileRef.current?.click()}><Upload size={17}/>{working?"正在处理…":"上传Excel，查看预览"}</button><span className="muted">支持 .xlsx、.csv；只读取表格内容，原文件不保存到服务器。</span></div>
   <input aria-label="子SKU关联表格" type="file" accept=".xlsx,.csv" ref={fileRef} hidden onChange={e=>{const file=e.target.files?.[0];if(file&&!locked)void read(file);e.target.value="";}}/>
   {error&&<div role="alert" className="message error">{error}</div>}
   {message&&<div role="status" className="child-import-message">{message}</div>}
   {input&&preview&&<>
    <div className="child-import-summary"><strong>{filename}</strong><span>{input.recipes.length} 个销售SKU</span><span>{input.stocks.length} 种实物</span><span>{input.rows} 条对应关系</span><button className="text-btn" disabled={locked} onClick={()=>{setInput(null);setRun(null);setConfirmed(false);setMessage("");setError("");}}>清空预览</button></div>
    {preview.errors.length>0&&<div className="message error" role="alert">{preview.errors.slice(0,10).map(e=><p key={e}>{e}</p>)}{preview.errors.length>10&&<p>另外还有 {preview.errors.length-10} 项，请修正后重新上传。</p>}</div>}
    <h3>1. 检查每卖一份扣哪些实物</h3><p className="muted">每个销售SKU的关联按整份清单保存，请列全它要发的所有实物。已有历史扣减的规则如需更改，系统会阻止覆盖并提示核对。</p>
    <div className="table-scroll"><table><thead><tr><th>销售SKU</th><th>关联种数</th><th>每卖一份实际扣减</th></tr></thead><tbody>{input.recipes.slice(page*20,page*20+20).map(r=><tr key={r.sales_code}><td><strong>{productMap.get(r.sales_code)?.name||"尚未建档"}</strong><code>{r.sales_code}</code><small>{productMap.get(r.sales_code)?.spec}</small></td><td>{r.items.length} 种</td><td>{r.items.map(i=><div className="child-import-item" key={i.stock_code}><span>{stockMap.get(i.stock_code)?.name||i.stock_code}<code>{i.stock_code}</code></span><strong>× {i.per_unit} {stockMap.get(i.stock_code)?.unit}</strong></div>)}</td></tr>)}</tbody></table></div>
    {pager(page,input.recipes.length,setPage)}
    <h3>2. 检查仓库真实数量</h3><p className="muted">留空表示待盘点，0表示确实没有库存。已有实物的名称、成本和库位沿用当前资料；已盘点数量不会被此入口覆盖，需要校准时请使用“重新盘点”。</p>
    <div className="table-scroll"><table><thead><tr><th>实物子SKU</th><th>表中真实库存</th><th>盘点时间（北京时间）</th><th>导入处理</th></tr></thead><tbody>{preview.children.slice(stockPage*20,stockPage*20+20).map(s=><tr key={s.code}><td><strong>{s.existing?.name||s.name}</strong><code>{s.code}</code></td><td>{s.quantity==null?"未填写":`${number(s.quantity)} ${s.unit}`}</td><td>{s.quantity==null?"—":s.count_at?time(s.count_at):"使用下方统一盘点时间"}</td><td><span className="badge">{s.status}</span>{s.existing?.quantity!=null&&<small>当前 {number(s.existing.quantity)} {s.unit}，保留</small>}</td></tr>)}</tbody></table></div>
    {pager(stockPage,preview.children.length,setStockPage)}
    <div className="child-import-confirm"><label>表内未填写时间时，统一使用此盘点时间（北京时间）<input type="datetime-local" value={at} disabled={locked||!!run} onChange={e=>{setAt(e.target.value);setConfirmed(false);}} required/></label><small>填写实际数清库存的时间。系统会接续该时间之后尚未扣减的有效订单；盘点时间之前的订单不扣本次库存。</small><label className="child-import-check"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e=>setConfirmed(e.target.checked)}/>我已核对实物、每份扣减数量和盘点时间；每个销售SKU的关联已列全。</label><button className="button primary" disabled={locked||!confirmed||!!preview.errors.length||!at} onClick={()=>void save()}><Check size={17}/>{working?"正在导入…":run?`继续导入（${run.next}/${run.batches.length} 批）`:"确认导入子SKU与关联"}</button></div>
   </>}
  </div>
 </section>;
}
