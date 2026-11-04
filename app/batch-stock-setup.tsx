"use client";
import {useState} from "react";
import {Plus,Trash2,Check,ArrowRight} from "lucide-react";
import {number,type Product,type PhysicalStock} from "../lib/model";
import {makePaperPlan,parseNumberRange,papersForRange,type PaperDraft} from "../lib/paper-plan";

type Link={code:string;start:string;end:string};
type Props={products:Product[];stocks:PhysicalStock[];busy:boolean;prefill:string;onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>};
export default function BatchStockSetup({products,stocks,busy,prefill,onAction}:Props){
 const [name,setName]=useState(""),[prefix,setPrefix]=useState(""),[start,setStart]=useState("1"),[end,setEnd]=useState("50"),[perSheet,setPerSheet]=useState("50");
 const [draft,setDraft]=useState<PaperDraft[]|null>(null),[quantities,setQuantities]=useState<Record<string,string>>({}),[costValue,setCost]=useState(""),[location,setLocation]=useState("");
 const [sameQty,setSameQty]=useState(""),[picker,setPicker]=useState(""),[error,setError]=useState(""),[reviewed,setReviewed]=useState(false);
 const [links,setLinks]=useState<Link[]>(()=>{const p=products.find(p=>p.code===prefill),r=p?parseNumberRange([p.name,p.spec].join(" ")):null;return p?[{code:p.code,start:r?String(r.start):"",end:r?String(r.end):""}]:[];});
 const stockMap=new Map(stocks.map(s=>[s.code,s]));
 const newPapers=draft?.filter(p=>!stockMap.has(p.code))??[];
 const invalid=draft?.some(p=>stockMap.get(p.code)?.archived)??false;
 const previews=links.map(l=>{try{return {...l,papers:papersForRange(draft??[],Number(l.start),Number(l.end)),error:""};}catch(e){return {...l,papers:[],error:e instanceof Error?e.message:"请填写销售范围"};}});
 const validDraft=!!draft?.length&&!invalid&&previews.every(p=>!p.error);
 function change(setter:(s:string)=>void,value:string){setter(value);setDraft(null);setReviewed(false);setError("");}
 function addCode(){const code=picker.trim(),p=products.find(p=>p.code===code);if(!p){setError("请先新增这个ERP销售SKU，再进行关联");return;}if(links.some(l=>l.code===code))return;if(links.length>=20){setError("一次最多关联20个销售编码");return;}const r=parseNumberRange([p.name,p.spec].join(" "));setLinks([...links,{code,start:r?String(r.start):"",end:r?String(r.end):""}]);setPicker("");setReviewed(false);setError("");}
 return <div className="batch-setup">
  <section className="panel form-panel">
   <div className="setup-step"><span>1</span><div><h2>按实际印刷方式生成纸张</h2><p>一张纸是一个仓库库存单位。销售SKU沿用ERP编码。</p></div></div>
   <form onSubmit={e=>{e.preventDefault();try{setDraft(makePaperPlan({name,prefix,start:Number(start),end:Number(end),perSheet:Number(perSheet)}));setReviewed(false);setError("");}catch(e){setError(e instanceof Error?e.message:"生成失败");}}}>
    <div className="form-grid"><label>货品名称：含颜色、尺寸<input required value={name} onChange={e=>change(setName,e.target.value)} placeholder="例如：黑色15厘米数字贴" maxLength={280}/></label><label>纸张内部编码前缀<input required value={prefix} onChange={e=>change(setPrefix,e.target.value)} placeholder="例如：NUM-BLACK-15CM" maxLength={130}/><small>同一货品重复生成时使用相同前缀，可复用已有纸张。</small></label></div>
    <div className="form-grid paper-plan-range"><label>起始数字<input required type="number" min="1" step="1" value={start} onChange={e=>change(setStart,e.target.value)}/></label><label>结束数字<input required type="number" min={start||1} max="100000" step="1" value={end} onChange={e=>change(setEnd,e.target.value)}/></label><label>每张有几个连续数字<input required type="number" min="1" step="1" value={perSheet} onChange={e=>change(setPerSheet,e.target.value)}/></label></div>
    <p className="note-box">小尺寸整张1～50：范围1～50，每张50个。大尺寸两贴一张：范围1～100，每张2个，生成1～2、3～4……99～100。</p>
    <button className="button secondary" disabled={busy}><ArrowRight size={16}/>生成草稿并核对</button>
   </form>
  </section>
  {error&&<div className="message error" role="alert">{error}</div>}
  {draft&&<form onSubmit={e=>{e.preventDefault();if(!validDraft||!reviewed)return;void onAction({action:"paper_setup",stocks:newPapers.map(p=>({code:p.code,name:p.name,spec:p.spec,quantity:quantities[p.code]?.trim()?Number(quantities[p.code]):null,cost:costValue.trim()?Number(costValue):null,location,minimum:10,note:"按实际印刷版面批量建立"})),recipes:previews.map(p=>({sales_code:p.code,items:p.papers.map(s=>({stock_code:s.code,per_unit:1}))}))},"纸张和关联已保存。未填实际张数的纸张仍待盘点；销售SKU数量由用纸规则换算。").then(ok=>{if(ok){setDraft(null);setLinks([]);setQuantities({});setReviewed(false);}});}}>
   <section className="panel form-panel">
    <div className="setup-step"><span>2</span><div><h2>确认仓库实际张数</h2><p>{draft.length}种纸张：新建{newPapers.length}种，复用{draft.length-newPapers.length}种。只填写每种纸张自己的实盘张数。</p></div></div>
    {newPapers.length>0&&<><div className="form-grid"><label>新纸张每张成本（元，可留空）<input type="number" min="0" step="any" value={costValue} onChange={e=>{setCost(e.target.value);setReviewed(false);}}/></label><label>新纸张库位（可留空）<input value={location} onChange={e=>{setLocation(e.target.value);setReviewed(false);}}/></label></div><div className="batch-fill"><label>所有新纸张各有相同张数时才使用<input type="number" min="0" step="1" value={sameQty} onChange={e=>setSameQty(e.target.value)} placeholder="例如：每种纸张各有1000张"/></label><button type="button" className="button secondary small" disabled={busy||sameQty.trim()===""||!Number.isSafeInteger(Number(sameQty))||Number(sameQty)<0} onClick={()=>{setQuantities({...quantities,...Object.fromEntries(newPapers.map(p=>[p.code,sameQty]))});setReviewed(false);}}>填入各新纸张</button></div></>}
    <div className="table-scroll batch-preview-table"><table><thead><tr><th>实际纸张 / 内部编码</th><th>处理方式</th><th>实际张数</th></tr></thead><tbody>{draft.map(p=>{const old=stockMap.get(p.code);return <tr key={p.code}><td><strong>{old?.name??p.name}</strong><code>{p.code}</code><small>{old?.spec??p.spec}</small></td><td><span className={"badge "+(old?.archived?"red":old?"green":"warm")}>{old?.archived?"已移除，需先恢复":old?"复用已有库存":"新建纸张"}</span></td><td>{old?<><strong>{number(old.quantity)}</strong><small>{old.quantity==null?"待盘点":"张 · 保留原数量"}</small></>:<label className="batch-count-label"><span className="sr-only">{p.name}实际张数</span><input aria-label={p.name+"实际张数"} type="number" min="0" step="1" value={quantities[p.code]??""} placeholder="留空：待盘点" onChange={e=>{setQuantities({...quantities,[p.code]:e.target.value});setReviewed(false);}}/></label>}</td></tr>;})}</tbody></table></div>
    <p className="paper-footnote">销售1～10、1～20等规格不再填写独立库存。只有这张表中的实物张数计入仓库总库存。</p>
   </section>
   <section className="panel form-panel">
    <div className="setup-step"><span>3</span><div><h2>关联ERP销售规格</h2><p>输入商家编码，再核对销售数字范围。每份订单消耗每种关联纸张各1张。</p></div></div>
    <div className="batch-fill"><label>选择已建档的销售SKU<input list="batch-sales-list" value={picker} onChange={e=>setPicker(e.target.value)} placeholder="输入或选择ERP商家编码"/><datalist id="batch-sales-list">{products.map(p=><option key={p.code} value={p.code}>{p.name} · {p.spec}</option>)}</datalist></label><button type="button" className="button secondary small" disabled={busy||links.length>=20} onClick={addCode}><Plus size={16}/>添加关联</button></div>
    {links.map((l,i)=>{const p=products.find(p=>p.code===l.code),preview=previews[i];return <div className="batch-sale-row" key={l.code}><div><strong>{p?.name}</strong><code>{l.code}</code></div><label>销售起始数字<input required aria-label={l.code+"销售起始数字"} type="number" min={Number(start)} max={Number(end)} step="1" value={l.start} onChange={e=>{setLinks(links.map((x,j)=>i===j?{...x,start:e.target.value}:x));setReviewed(false);}}/></label><label>销售结束数字<input required aria-label={l.code+"销售结束数字"} type="number" min={Number(l.start)||1} max={Number(end)} step="1" value={l.end} onChange={e=>{setLinks(links.map((x,j)=>i===j?{...x,end:e.target.value}:x));setReviewed(false);}}/></label><button type="button" className="icon-btn" aria-label={"取消关联"+l.code} onClick={()=>{setLinks(links.filter((_,j)=>j!==i));setReviewed(false);}}><Trash2 size={16}/></button><p className={preview.error?"negative":"muted"}>{preview.error||"卖1份 → "+preview.papers.length+"种纸张，共"+preview.papers.length+"张："+preview.papers.map(s=>s.start+"～"+s.end).join("、")}</p></div>;})}
    {!links.length&&<p className="note-box">可以先只建立纸张，之后在销售SKU的“关联库存”中设置；销量仍按原ERP商家编码统计。</p>}
    {links.length>0&&<p className="paper-footnote">若销售范围只用到一张纸中的部分数字，仍按整张出库。不同颜色、尺寸请分开生成和关联。</p>}
    {links.some(l=>products.some(p=>p.code===l.code&&p.stock_mode!=="recipe"&&p.quantity!=null))&&<p className="accent">本次包含已填独立成品库存的销售SKU。保存关联后，原独立库存停止使用，请先核对上方的实物纸张张数。</p>}
   </section>
   <section className="panel form-panel batch-submit"><strong>本次保存：新建{newPapers.length}种纸张，关联{links.length}个销售规格</strong><p className="muted">新纸张已填数量的库存和新关联均从保存时起算。已有纸张保留自己的盘点时间；已扣减的历史规则不能覆盖。</p><label className="confirmation-choice"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已核对纸张版面、各自实际张数和销售规格的发货用纸</label><button className="button primary" disabled={busy||!validDraft||!reviewed||(!newPapers.length&&!links.length)}><Check size={16}/>{busy?"保存中…":"保存纸张与关联"}</button></section>
  </form>}
 </div>;
}
