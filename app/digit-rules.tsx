'use client';
import {useState} from 'react';
import {Download} from 'lucide-react';
import DigitRemarkRules from './digit-remark-rules';
import DigitConditionsPanel from './digit-conditions';
import {clientId} from '../lib/client-id';
import type {PrintData} from '../lib/printing';
import type {DigitRuleExport} from '../lib/digit-rule-export';
import './printing.css';
import './digit-rules.css';
import DigitRuleImport from './digit-rule-import';
import DigitBoardRules from './digit-board-rules';
type Props={data:PrintData;busy:boolean;onAction:(b:Record<string,unknown>,message:string)=>Promise<boolean>};
export default function DigitRules({data,busy,onAction}:Props){
 const [tab,setTab]=useState<'remarks'|'conditions'|'boards'>('remarks'),[exporting,setExporting]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function exportRules(){setExporting(true);setError('');setMessage('');try{
  const response=await fetch('/api/warehouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'digit_rules_export',request_id:clientId()})});
  const result=await response.json() as {error?:string;digitRuleExport:DigitRuleExport};if(!response.ok)throw new Error(result.error||'导出失败，请重试');
  const snapshot=result.digitRuleExport;if(snapshot?.format!=='warehouse-digit-rules')throw new Error('规则文件格式异常，请刷新后重试');
  const filename='数字贴规则_'+new Date(Date.parse(snapshot.exported_at)+8*3600000).toISOString().slice(0,19).replace('T','_').replaceAll(':','-')+'.json';
  const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json;charset=utf-8'})),a=document.createElement('a');
  try{a.href=url;a.download=filename;a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
  setMessage('规则文件已生成：'+snapshot.summary.base_standards+'项基础标准、'+snapshot.summary.keyword_rules+'条关键词规则、'+snapshot.summary.stock_conditions+'条备货条件。请保存下载的JSON文件。');
 }catch(e){setError(e instanceof Error?e.message:'导出失败，请重试');}finally{setExporting(false);}}
 return <div className="printing-page digit-rules-page">
  <div className="digit-rules-toolbar"><div className="print-tabs"><button type="button" className={tab==='remarks'?'active':''} onClick={()=>setTab('remarks')}>备注识别规则</button><button type="button" className={tab==='conditions'?'active':''} onClick={()=>setTab('conditions')}>数字贴条件</button><button type="button" className={tab==='boards'?'active':''} onClick={()=>setTab('boards')}>版面扣减规则</button></div><button type="button" className="button secondary" disabled={busy||exporting} onClick={()=>void exportRules()}><Download size={16}/>{exporting?'正在导出…':'导出规则'}</button><DigitRuleImport busy={busy||exporting} onAction={onAction}/></div>
  <p className="print-note digit-export-note">仅用于数字贴。导出包含全部备注规则、备货条件及相关版面关联，保存为JSON文件，可导入预览后合并恢复。规则文件不含实际库存数量和订单。</p>
  {error&&<div className="message error" role="alert">{error}</div>}{message&&<p className="digit-export-success" role="status">{message}</p>}
  {tab==='boards'?<DigitBoardRules/>:tab==='remarks'?<DigitRemarkRules rules={data.digitRemarkRules} busy={busy||exporting} onAction={onAction}/>:<DigitConditionsPanel conditions={data.digitConditions??[]} rules={data.printRules??[]} busy={busy||exporting} onAction={onAction}/>}
 </div>;
}
