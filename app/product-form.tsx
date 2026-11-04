"use client";
import "./product-form.css";
import ProductImages from "./product-images";
import {useState} from "react";
import {Check, LoaderCircle, Trash2} from "lucide-react";
import {chinaTime, localDateTime, money, type Product} from "../lib/model";

export default function ProductForm({product:p,isNew,busy,onSave,onDelete}:{product:Partial<Product>;isNew:boolean;busy:boolean;onSave:(p:Partial<Product>,confirmCount?:boolean)=>void;onDelete?:()=>Promise<void>}) {
 const [at,setAt]=useState(localDateTime());
 const [mode,setMode]=useState<""|"direct"|"recipe">(p.stock_mode ?? (isNew?"":"direct"));
 const [managed,setManaged]=useState(p.tracking_enabled!==0);
 const [confirmCount,setConfirmCount]=useState(false);
 const [useNow,setUseNow]=useState(true);
 const [deleting,setDeleting]=useState(false);
 async function remove(){
  if(busy||deleting||!onDelete)return;
  if(!window.confirm(`确认删除这个待关联商品？\n\n${p.name}\n商家编码：${p.code}\n\n删除后会从商品清单中移除。若以后需要使用，需重新导入或新增。`))return;
  setDeleting(true);try{await onDelete();}finally{setDeleting(false);}
 }
 return <form className="modal-form product-editor-form" onSubmit={e => {
  e.preventDefault(); if(!mode||busy||deleting)return; const f=new FormData(e.currentTarget); const q=String(f.get("quantity") ?? "");
  onSave({...p,stock_mode:mode,tracking_enabled:managed?1:0,packing_cost:Number(f.get("packing_cost")??p.packing_cost??0),erp_code:String(f.get("erp_code")),size:String(f.get("size")),material:String(f.get("material")),code:String(f.get("code")),name:String(f.get("name")),category:String(f.get("category")),spec:String(f.get("spec")),pack:String(f.get("pack")),unit:String(f.get("unit")??p.unit??"份"),cost:p.cost_mode?(p.cost_mode==="按实物自动计算"?null:p.cost):String(f.get("cost") ?? "")===""?null:Number(f.get("cost")),location:String(f.get("location")),minimum:Number(f.get("minimum")),note:String(f.get("note")),...(isNew||confirmCount?{quantity:!managed||mode==="recipe"||q===""?null:Number(q),count_at:!managed||mode==="recipe"||q===""?null:useNow?Date.now():chinaTime(at)}:{})},managed&&confirmCount);
 }}>
  <div className="product-editor-fields">
  {p.source_product&&<p className="confirmation-box">基础商品资料在产品中心修改，保存后重新同步。这里维护实际库存、实物关联、库位和预警线；每份含量是包装数量，不是仓库库存。</p>}
  <ProductImages product={p} gallery/>
  {p.source_product&&<p className="warehouse-source-info">产品：{p.product_name||'未同步产品名称'} · 上次同步：{p.synced_at?new Date(p.synced_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'历史同步'} · 版本 {p.source_revision||'—'}</p>}
  <label>SKU编码（ERP商家编码） <span className="required">*</span><input name="code" defaultValue={p.code} readOnly={!isNew} required maxLength={160} placeholder="与ERP商家编码保持完全一致"/></label>
  <label>规格名称 <span className="required">*</span><input name="name" readOnly={!!p.source_product} defaultValue={p.name} required maxLength={300} placeholder="商品名称 + 款式 + 销售规格"/></label>
  {isNew&&<div className="setup-step"><span>1</span><div><h2>建立销售SKU</h2><p>保留ERP原商家编码，用于匹配订单和分别统计销量。</p></div></div>}
  <label className="confirmation-choice"><input type="checkbox" checked={managed} onChange={e=>{setManaged(e.target.checked);setConfirmCount(false);if(!e.target.checked&&!mode)setMode("direct");}}/>需要管理库存（取消则仅统计销售）</label><p className="muted">仅统计销售的商品保留销量与成本，不进入盘点和库存预警。停用后保留已记录库存，重新启用需再次盘点实际数量。</p>
  <label>库存方式 <span className="required">*</span><select required value={mode} disabled={!isNew||!managed} onChange={e => setMode(e.target.value as "direct"|"recipe")}><option value="" disabled>请选择库存管理方式</option><option value="direct">独立成品：单独盘点，卖1份减1份</option><option value="recipe">共用实物：按每份含量或实物规则扣库存</option></select><small>{mode==="recipe"?"本SKU不填初始库存。保存后直接进入实物关联。":mode==="direct"?"此SKU有自己独立的实物库存，填仓库实际数量。":"数字贴共用整张、或一份需发多种纸张时，选择关联实际纸张。"}</small></label>
  <div className="form-grid">
   <label>ERP商品编码<input name="erp_code" readOnly={!!p.source_product} defaultValue={p.erp_code??""} maxLength={160} placeholder="商品主编码，可留空"/></label>
   <label>尺寸<input name="size" readOnly={!!p.source_product} defaultValue={p.size??""} maxLength={160} placeholder="例如：9×3.3cm"/></label>
   <label>材质<input name="material" readOnly={!!p.source_product} defaultValue={p.material??""} maxLength={160} placeholder="例如：铜版纸覆亮膜"/></label>
   <label>产品类型<input name="category" readOnly={!!p.source_product} defaultValue={p.category} placeholder="例如：数字贴"/></label>
   <label>销售规格说明<input name="spec" readOnly={!!p.source_product} defaultValue={p.spec} placeholder="例如：1厘米，1～10"/></label>
   <label>每份含量<input name="pack" readOnly={!!p.source_product} defaultValue={p.pack} placeholder="例如：100贴 / 份"/></label>
   <label>销售单位<select disabled={!!p.source_product} name="unit" defaultValue={p.unit||"份"}>{["份","包","卷","张","套","件"].map(u => <option key={u}>{u}</option>)}</select></label>
   {p.cost_mode?<label>成本方式<input readOnly value={p.cost_mode}/><small>{p.cost_mode==="按实物自动计算"?"由实物单价和消耗数量计算；基础价格在产品中心维护后手动同步。":"固定整份成本在产品中心维护，再同步到仓库。"}</small></label>:<><label>每份完整成本（元）<input name="cost" type="number" min="0" step="any" defaultValue={p.cost??""} placeholder="共用库存可留空按实物成本换算"/></label>{mode==="recipe"&&<label>每份包装及人工成本（元）<input name="packing_cost" type="number" min="0" step="any" defaultValue={p.packing_cost??0}/><small>仅在完整成本留空时加入实物换算成本；完整成本已经包含的费用不重复计算。</small></label>}
   </>}
   {p.source_product&&<label>参考销售价<input readOnly value={money(p.price)}/><small>由产品中心同步，不改写历史订单金额。</small></label>}
   <label>可售数量预警线<input name="minimum" type="number" min="0" step="1" defaultValue={p.minimum??10}/></label>
   <label>仓库库位<input name="location" defaultValue={p.location} placeholder="例如：A区 / 03架"/></label>
   {isNew&&managed&&mode==="direct"&&<label>初始入库数量<input name="quantity" type="number" min="0" step="1" defaultValue={p.quantity??""} placeholder="未确认可留空，之后盘点"/></label>}
  </div>
  {!isNew&&managed&&mode==="direct"&&<div className="confirmation-box"><label className="confirmation-choice"><input type="checkbox" checked={confirmCount} onChange={e=>{setConfirmCount(e.target.checked);setAt(localDateTime());}}/>同时确认这个产品的真实库存</label><p>只保存商品资料时，库存数量和盘点时间保持原状。确认实盘后，这个产品单独开始按有效订单扣减。</p>{confirmCount&&<label>本次实盘数量（{p.unit||"份"}）<input required name="quantity" type="number" min="0" step="1" placeholder="填写现在盘点到的真实数量，零库存填0"/></label>}</div>}
  {managed&&(isNew||confirmCount)&&mode==="direct"&&<><label className="confirmation-choice"><input type="checkbox" checked={useNow} onChange={e=>{setUseNow(e.target.checked);setAt(localDateTime());}}/>按保存时的当前时间起算</label>{!useNow&&<label>本次库存起算时间<input required type="datetime-local" value={at} max={localDateTime()} onChange={e=>setAt(e.target.value)}/></label>}<p className="muted">每个产品保留自己的起算时间，之前的订单只作销售分析。</p></>}
  {mode==="recipe"&&<p className="muted">实物数量和每单位成本在“实物库存”填写。各销售规格保持独立，按规则换算实物消耗；每份完整成本保留原值，留空时按实物成本加包装人工换算。</p>}
  <label>商品备注<textarea readOnly={!!p.source_product} name="note" defaultValue={p.note} placeholder="记录规格、排版等"/></label>
  </div>
  <div className="modal-actions product-editor-actions"><span className="muted">一个商家编码对应一个销售规格</span><div className="product-editor-buttons">{!isNew&&onDelete&&<button type="button" className="button product-delete-button" disabled={busy||deleting} onClick={()=>void remove()}>{deleting?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>} {deleting?"正在删除…":"删除商品"}</button>}<button type="submit" className="button primary" disabled={busy||deleting||!mode}>{busy&&!deleting?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} {busy&&!deleting?"正在保存…":`保存${isNew?mode==="recipe"?"SKU并关联库存":"并建立SKU":confirmCount?"并确认真实库存":"商品资料"}`}</button></div></div>
 </form>;
}
