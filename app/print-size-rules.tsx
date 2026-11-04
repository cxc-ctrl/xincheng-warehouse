'use client';
import {useState} from 'react';
import {Plus,Save} from 'lucide-react';
import {money,number,type OrderLine} from '../lib/model';
import {estimatePrinting,printNumber} from '../lib/print-recipes';
import {EMPTY_PAPER,type PrintPaperSettings,type PrintSizeRule} from '../lib/printing';

type Action=(body:Record<string,unknown>,message:string)=>Promise<boolean>;
const text=(n:number|null|undefined)=>n==null?'':String(n);
function RuleEditor({item,size,busy,paper,onAction,onSaved}:{item?:PrintSizeRule;size:number;busy:boolean;paper:PrintPaperSettings;onAction:Action;onSaved:()=>void}){
 const [draft,setDraft]=useState({size_cm:text(item?.size_cm??(size||null)),per_sheet:text(item?.per_sheet??(size===15?2:null)),sheet_cost:text(item?.sheet_cost),sheet_weight_g:text(item?.sheet_weight_g),enabled:item?.enabled??1}),[start,setStart]=useState('1'),[end,setEnd]=useState('200'),[quantity,setQuantity]=useState('1'),[error,setError]=useState('');
 let preview:ReturnType<typeof estimatePrinting>|null=null,previewError='';
 try{
  const size=printNumber(draft.size_cm,'尺寸'),per=printNumber(draft.per_sheet,'每张可印数量',true),from=printNumber(start,'起始号',true),to=printNumber(end,'结束号',true),qty=printNumber(quantity,'购买份数',true),cost=printNumber(draft.sheet_cost,'每张打印成本'),weight=printNumber(draft.sheet_weight_g,'每张重量');
  if(size&&size<=200&&per&&from&&to&&qty&&to>=from&&weight!==0){
   const rule:PrintSizeRule={size_cm:size,per_sheet:per,sheet_cost:cost,sheet_weight_g:weight,enabled:1,updated_at:0};
   preview=estimatePrinting([{key:'preview',code:'预览',title:'数字贴',spec:`${size}cm，${from}-${to}各1个`,quantity:qty} as OrderLine],[],paper,[rule]);
  }else previewError='填写尺寸、每张可印数量和有效数字范围后显示计算结果。';
 }catch(e){previewError=e instanceof Error?e.message:'请检查填写的数字';}
 async function save(){
  setError('');try{
   if(!preview||preview.sheets==null)throw new Error('请先填写有效尺寸和每张可印数量');
   const ok=await onAction({action:'print_size_rule',...draft,updated_at:item?.updated_at??0},'通用打印规则已保存，同尺寸的不同数字范围已自动套用。');if(ok)onSaved();
  }catch(e){setError(e instanceof Error?e.message:'保存失败');}
 }
 return <div className="print-size-editor"><form onSubmit={e=>{e.preventDefault();void save();}}><div className="print-size-fields">{([['size_cm','数字贴尺寸（cm）','例如15'],['per_sheet','每张大纸可印数量（个）','例如2'],['sheet_cost','每张大纸打印成本（元）','留空用统一纸张成本'],['sheet_weight_g','每张大纸重量（g）','留空用统一纸张重量']] as const).map(([key,label,hint])=><label key={key}>{label}<input aria-label={label} inputMode={key==='per_sheet'?'numeric':'decimal'} required={key==='size_cm'||key==='per_sheet'} readOnly={key==='size_cm'&&!!item} value={draft[key]} placeholder={hint} disabled={busy} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div><div className="print-size-save"><label><input type="checkbox" checked={draft.enabled===1} disabled={busy} onChange={e=>setDraft({...draft,enabled:e.target.checked?1:0})}/>启用这个尺寸的通用规则</label><button className="button primary" disabled={busy}><Save size={15}/>{busy?'正在保存…':'保存通用规则'}</button></div>{error&&<p className="message error" role="alert">{error}</p>}</form><div className="print-size-preview"><h3>试算一下</h3><div className="print-size-range"><label>起始号<input aria-label="试算起始号" inputMode="numeric" value={start} onChange={e=>setStart(e.target.value)}/></label><span>～</span><label>结束号<input aria-label="试算结束号" inputMode="numeric" value={end} onChange={e=>setEnd(e.target.value)}/></label><label>购买份数<input aria-label="试算购买份数" inputMode="numeric" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label></div>{preview&&preview.sheets!=null?<><p className="print-size-result"><strong>{number(preview.sheets)} 张大纸</strong><span>打印成本 {preview.cost_cents==null?'待填写':money(preview.cost_cents/100)}</span><span>重量 {preview.weight_g==null?'待填写':number(preview.weight_g)+' g'}</span></p><p className="print-note">{preview.rows[0]?.formula}</p><p className="print-note">这是当前填写值的预览；点击保存后，订单才会应用。</p></>:<p className="print-note">{previewError}</p>}</div></div>;
}
export default function PrintSizeRules({rules,paper=EMPTY_PAPER,busy,onAction,prefill}:{rules:PrintSizeRule[];paper?:PrintPaperSettings;busy:boolean;onAction:Action;prefill?:number}){
 const [selected,setSelected]=useState<number|null>(prefill??(rules.length?null:15)),[notice,setNotice]=useState('');
 const item=rules.find(r=>r.size_cm===selected),enabled=rules.filter(r=>r.enabled).length;
 return <section className="panel print-size-panel"><div className="print-size-heading"><div><h3>通用打印规则</h3><p>按尺寸设置一次，1～100、1～200、1～300等不同范围自动计算。</p></div><button className="button secondary" disabled={busy} onClick={()=>{setSelected(0);setNotice('');}}><Plus size={15}/>新增尺寸</button></div><p className="print-notice">每份张数＝数字个数 ÷ 每张可印数量，向上取整；总张数再乘购买份数。成本和重量按总张数计算。</p>{!!rules.length&&<div className="table-scroll"><table className="print-size-table"><thead><tr><th>尺寸</th><th>每张大纸可印</th><th>每张打印成本</th><th>每张重量</th><th>状态</th><th>操作</th></tr></thead><tbody>{rules.map(r=><tr key={r.size_cm}><td><strong>{r.size_cm} cm</strong></td><td>{r.per_sheet} 个数字</td><td>{money(r.sheet_cost??paper.sheet_cost)}</td><td>{(r.sheet_weight_g??paper.sheet_weight_g)==null?'待填写':number(r.sheet_weight_g??paper.sheet_weight_g)+' g'}</td><td>{r.enabled?'已启用':'已停用'}</td><td><button className="text-btn" disabled={busy} onClick={()=>{setSelected(r.size_cm);setNotice('');}}>修改 / 试算</button></td></tr>)}</tbody></table></div>}{selected!=null&&<RuleEditor key={selected+':'+(item?.updated_at??0)} item={item} size={selected} paper={paper} busy={busy} onAction={onAction} onSaved={()=>{setNotice('规则已保存，打印任务中的预计张数、成本和重量会自动更新。');setSelected(null);}}/>}{notice&&<p className="print-size-success" role="status">{notice}</p>}{selected==null&&!enabled&&<p className="print-note">还没有启用通用规则，点击“新增尺寸”开始设置。</p>}<p className="print-note">成本、重量可暂时留空。特殊SKU规则优先；无法明确读取尺寸或数字范围的订单仍需核对。修改规则只更新预计值，已保存的实际成本保持原值。</p></section>;
}
