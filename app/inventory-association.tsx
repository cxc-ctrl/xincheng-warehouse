"use client";
import {useMemo,useState} from "react";
import {Check,Plus,Trash2,Link2} from "lucide-react";
import {PHYSICAL_UNITS,number,stockUnit,type Product,type PhysicalStock,type StockRule} from "../lib/model";
import {associationGroups,associationIssue,numericSticker,recipeSnapshot,salesPack,type AssociationGroup} from "../lib/inventory-association";
import SalesSkuPicker from "./sales-sku-picker";
import "./inventory-association.css";
type Link={code:string;quantity:string};
type Props={stock:PhysicalStock|null;products:Product[];stocks:PhysicalStock[];rules:StockRule[];busy:boolean;onAction:(body:Record<string,unknown>,message:string)=>Promise<boolean>};
export default function InventoryAssociation({stock,products,stocks,rules,busy,onAction}:Props){
 const [mode,setMode]=useState<"existing"|"new">(stock?"existing":"new");
 const [originalRules]=useState(()=>rules.map(r=>({...r})));
 const original=originalRules.filter(r=>r.stock_code===stock?.code);
 const [links,setLinks]=useState<Link[]>(()=>original.map(r=>({code:r.sales_code,quantity:String(r.per_unit)})));
 const [newLinks,setNewLinks]=useState<Link[]>([]),[error,setError]=useState("");
 const [overrides,setOverrides]=useState<Record<string,Partial<AssociationGroup["stock"]>>>({});
 const chosen=mode==="existing"?links:newLinks,setChosen=mode==="existing"?setLinks:setNewLinks;
 const selected=chosen.map(l=>products.find(p=>p.code===l.code)).filter((p):p is Product=>!!p);
 const removed=mode==="existing"?original.filter(r=>!chosen.some(l=>l.code===r.sales_code)).map(r=>r.sales_code):[];
 const plan=useMemo(()=>{try{return {groups:mode==="new"?associationGroups(selected,stocks,rules):[],error:""};}catch(e){return {groups:[],error:e instanceof Error?e.message:"无法识别库存规格"};}},[mode,chosen,products,stocks,rules]);
 const groups=mode==="existing"&&stock?[{key:stock.code,stock,existing:true,products:selected}]:plan.groups.map(g=>({...g,stock:{...g.stock,...overrides[g.key]}}));
 const issue=mode==="existing"&&stock?associationIssue(stock,selected,products.filter(p=>original.some(r=>r.sales_code===p.code)&&!removed.includes(p.code))):plan.error;
 const valid=!issue&&(chosen.length>0||removed.length>0)&&chosen.length+removed.length<=20&&chosen.every(l=>l.quantity.trim()!==""&&Number.isSafeInteger(Number(l.quantity))&&Number(l.quantity)>0&&Number(l.quantity)<=100000)&&groups.every(g=>g.stock.code.trim()&&g.stock.name.trim());
 function addMany(items:Product[]){const fresh=items.filter(p=>!chosen.some(l=>l.code===p.code));if(chosen.length+fresh.length>20){setError("每次最多关联20个SKU");return false;}setChosen(previous=>[...previous,...fresh.map(p=>({code:p.code,quantity:String(mode==="existing"?(originalRules.find(r=>r.sales_code===p.code&&r.stock_code===stock?.code)?.per_unit??(!numericSticker(p)&&stockUnit(stock??undefined)!=="张"?salesPack(p):null)??""):salesPack(p)??"")}))]);setError("");return true;}
 function updateStock(group:AssociationGroup,field:keyof AssociationGroup["stock"],value:string){setOverrides(previous=>({...previous,[group.key]:{...previous[group.key],[field]:value}}));if(field==="unit")setNewLinks(previous=>previous.map(l=>group.products.some(p=>p.code===l.code)?{...l,quantity:""}:l));}
 async function save(){
  if(!valid||busy)return;setError("");
  const payloadGroups=groups.filter(g=>g.products.length).map(g=>({new_stock:!g.existing,stock:g.stock,links:g.products.map(p=>({code:p.code,per_unit:Number(chosen.find(l=>l.code===p.code)!.quantity)}))}));
  const affected=[...payloadGroups.flatMap(g=>g.links.map(l=>l.code)),...removed];
  await onAction({action:"inventory_association",stock_code:mode==="existing"?stock?.code:"",groups:payloadGroups,removed,expected:recipeSnapshot(affected,originalRules)},mode==="existing"?"销售规格已关联到这条库存，库存数量和原成本保持不变。":"已按款式、尺寸建立或复用库存，新增库存保持待盘点。");
 }
 const picker=<SalesSkuPicker key={mode} products={products} addedCodes={chosen.map(l=>l.code)} suggestedQuery={mode==="new"?stock?.code.replace(/-STOCK$/,"").replace(/-[A-Z]$/,"")??"":stock?.code.replace(/-STOCK$/,"")??""} busy={busy} onAdd={addMany}/>;
 return <form className="inventory-association" onSubmit={e=>{e.preventDefault();void save();}}>
  <div className="inventory-association-content">
  {stock&&<div className="selected-sku"><Link2 size={22}/><div><strong>{stock.name}</strong><code>{stock.code}</code><small>{stock.spec||"规格未填写"} · 库存单位：{stockUnit(stock)} · {stock.quantity==null?"待盘点":number(stock.quantity)+stockUnit(stock)}</small></div></div>}
  {stock&&<div className="inventory-association-tabs"><button type="button" className={"period "+(mode==="existing"?"active":"")} onClick={()=>{setMode("existing");setError("");}}>关联当前库存</button><button type="button" className={"period "+(mode==="new"?"active":"")} onClick={()=>{setMode("new");setError("");}}><Plus size={15}/>新增款式 / 尺寸</button></div>}
  <p className="muted">{mode==="existing"?"选择这款实物对应的销售SKU，直接使用当前库存。名称、尺寸从商品资料带出；普通贴纸按包装数量预填，纸张版面请填写实际用张数。":"多选销售SKU，系统按款式、尺寸和材质分别整理；已有库存直接复用，新库存留待盘点。"}</p>
  {mode==="existing"&&original.length>0?<details className="inventory-association-picker"><summary>添加销售规格（可多选）</summary>{picker}</details>:picker}
  {(error||issue||chosen.length+removed.length>20)&&<p className="message error" role="alert">{error||issue||"本次设置与取消合计超过20个SKU，请分批修改。"}</p>}
  {groups.map(group=><section key={group.key} className="inventory-association-group">
   <div className="inventory-association-group-heading"><strong>{group.stock.name}</strong><span className="badge">{group.existing?"使用已有库存":"新增 · 待盘点"}</span></div>
   {mode==="new"&&!group.existing?<div className="form-grid"><label>库存名称<input required value={group.stock.name} disabled={busy} onChange={e=>updateStock(group,"name",e.target.value)}/></label><label>库存编码<input required maxLength={160} value={group.stock.code} disabled={busy} onChange={e=>updateStock(group,"code",e.target.value)}/></label><label>尺寸 / 实物规格<input value={group.stock.spec} disabled={busy} onChange={e=>updateStock(group,"spec",e.target.value)}/></label><label>库存单位<select value={group.stock.unit} disabled={busy} onChange={e=>updateStock(group,"unit",e.target.value)}>{PHYSICAL_UNITS.map(u=><option key={u}>{u}</option>)}</select></label></div>:<small>{group.stock.code} · {group.stock.spec||"规格未填写"} · 按{group.stock.unit||"张"}统计</small>}
   <div className="table-scroll"><table><thead><tr><th>销售规格 / ERP商家编码</th><th>尺寸</th><th>每卖1份扣减</th><th>操作</th></tr></thead><tbody>{group.products.map(p=>{
    const link=chosen.find(l=>l.code===p.code)!,other=originalRules.filter(r=>r.sales_code===p.code&&r.stock_code!==group.stock.code);
    return <tr key={p.code}><td><strong>{p.name}</strong><code>{p.code}</code><small>包装：{p.pack||salesPack(p)||"数量待填写"}</small>{other.length===1&&!originalRules.some(r=>r.sales_code===p.code&&r.stock_code===group.stock.code)&&<small className="accent">将从“{stocks.find(s=>s.code===other[0].stock_code)?.name||other[0].stock_code}”转到本库存</small>}{other.length>0&&originalRules.some(r=>r.sales_code===p.code&&r.stock_code===group.stock.code)&&<small>另有 {other.length} 种实物，继续保留原关联</small>}</td><td>{p.size||p.spec||"未填写"}</td><td><div className="qty-input"><input required aria-label={`${p.code} 每份扣减`} type="number" min="1" max="100000" step="1" value={link.quantity} disabled={busy} placeholder="填写实际消耗" onChange={e=>setChosen(previous=>previous.map(l=>l.code===p.code?{...l,quantity:e.target.value}:l))}/><span>{group.stock.unit||"张"}</span></div></td><td><button type="button" className="icon-btn" disabled={busy} aria-label={`取消本次关联 ${p.code}`} onClick={()=>setChosen(previous=>previous.filter(l=>l.code!==p.code))}><Trash2 size={16}/></button></td></tr>;
   })}</tbody></table></div>
  </section>)}
  {removed.length>0&&<p className="inventory-association-note">本次取消 {removed.length} 个SKU与当前库存的关联；只剩这一种实物的SKU会恢复“待关联”。</p>}
  </div>
  <div className="inventory-association-save"><span>{mode==="new"?`识别 ${groups.length} 款库存 · ${chosen.length} 个销售SKU`:`设置 ${chosen.length} 个销售SKU · 取消 ${removed.length} 个`}<small>这里只修改关联，盘点数量在保存后单独填写。</small></span><button className="button primary" disabled={busy||!valid}><Check size={17}/>{busy?"保存中…":"保存库存关联"}</button></div>
 </form>;
}
