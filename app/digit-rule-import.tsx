'use client';
import {useRef,useState} from 'react';
import {Upload,Check} from 'lucide-react';
import {clientId} from '../lib/client-id';
import type {DigitImportPreview} from '../lib/digit-rule-import';
type Props={busy:boolean;onAction:(b:Record<string,unknown>,message:string)=>Promise<boolean>};
const STATUS={add:'新增',update:'修改',same:'相同，保留',blocked:'需补齐 / 核对'};
export default function DigitRuleImport({busy,onAction}:Props){
 const fileInput=useRef<HTMLInputElement>(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[upload,setUpload]=useState<{name:string;file:unknown;requestId:string}|null>(null),[preview,setPreview]=useState<DigitImportPreview|null>(null),[confirmed,setConfirmed]=useState(false),[filter,setFilter]=useState('all'),[page,setPage]=useState(1);
 const locked=busy||working,rows=preview?.rows.filter(r=>filter==='all'||r.status===filter)??[],pages=Math.max(1,Math.ceil(rows.length/50)),current=Math.min(page,pages),changes=preview?(preview.counts.add+preview.counts.update):0;
 async function inspect(file:unknown,name:string){setWorking(true);setError('');setPreview(null);setConfirmed(false);try{
  const response=await fetch('/api/warehouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'digit_rules_preview',request_id:clientId(),file})});const data=await response.json() as {error?:string;digitImportPreview:DigitImportPreview};if(!response.ok)throw new Error(data.error||'规则预览失败');
  setUpload({name,file,requestId:clientId()});setPreview(data.digitImportPreview);setFilter('all');setPage(1);
 }catch(e){setError(e instanceof Error?e.message:'规则预览失败');}finally{setWorking(false);}}
 async function read(file:File){setError('');setMessage('');setPreview(null);setUpload(null);setConfirmed(false);if(file.size>5*1024*1024){setError('规则文件超过5MB，请检查是否选择了正确的JSON备份。');return;}try{await inspect(JSON.parse((await file.text()).replace(/^\uFEFF/,'')),file.name);}catch{setError('文件不是有效JSON，请选择本系统导出的数字贴规则备份。');}}
 async function apply(){if(!preview||!upload||!confirmed||!changes)return;setWorking(true);setError('');try{
  const ok=await onAction({action:'digit_rules_import',request_id:upload.requestId,file:upload.file,preview_token:preview.token,confirm:true,skip_blocked:true},'数字贴规则已导入；相同配置保留，待补齐项目已跳过。');
  if(ok){setMessage('已导入 '+changes+' 项规则配置'+(preview.counts.blocked?'；'+preview.counts.blocked+' 项待补齐或人工核对，补齐后可再次导入。':'。'));setPreview(null);setUpload(null);setConfirmed(false);}else setError('导入未完成，请查看页面提示；如果数据已变化，请重新预览。');
 }finally{setWorking(false);}}
 return <div className="digit-rule-import">
  <button type="button" className="button secondary" disabled={locked} onClick={()=>fileInput.current?.click()}><Upload size={16}/>{working?'正在处理…':'导入规则'}</button><input ref={fileInput} type="file" hidden accept=".json,application/json" aria-label="选择数字贴规则备份" onChange={e=>{const f=e.target.files?.[0];if(f)void read(f);e.target.value='';}}/>
  {(error||message)&&<div className="digit-import-feedback">{error&&<p className="message error" role="alert">{error}</p>}{message&&<p className="digit-export-success" role="status">{message}</p>}</div>}
  {preview&&upload&&<section className="panel digit-import-preview" aria-label="数字贴规则导入预览"><header><div><h2>导入前核对</h2><p>{upload.name}</p></div><button type="button" className="button secondary small" disabled={locked} onClick={()=>{setPreview(null);setUpload(null);setConfirmed(false);}}>取消</button></header>
   <div className="digit-import-counts"><span>新增 <strong>{preview.counts.add}</strong></span><span>修改 <strong>{preview.counts.update}</strong></span><span>相同保留 <strong>{preview.counts.same}</strong></span><span>需补齐 / 核对 <strong>{preview.counts.blocked}</strong></span></div>
   <ul className="digit-import-notes">{preview.notes.map(n=><li key={n}>{n}</li>)}</ul>
   <div className="digit-import-filter"><label>显示项目<select aria-label="筛选导入预览" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="all">全部项目</option>{Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><span>文件共 {preview.rows.length} 项</span></div>
   <div className="digit-import-table"><table><thead><tr><th>类型 / 名称</th><th>处理</th><th>说明 / 变更内容</th></tr></thead><tbody>{rows.slice((current-1)*50,current*50).map((r,i)=><tr key={r.kind+r.key+i}><td><strong>{r.name}</strong><small>{r.kind} · {r.key}</small></td><td><span className={'digit-import-status '+r.status}>{STATUS[r.status]}</span></td><td>{r.reason&&<p>{r.reason}</p>}{r.status!=='same'&&<details><summary>查看导入前后</summary><label>当前配置<pre>{r.before}</pre></label><label>文件配置<pre>{r.after}</pre></label></details>}</td></tr>)}</tbody></table>{!rows.length&&<p className="print-note">当前分类没有项目。</p>}</div>
   <div className="digit-import-pagination"><span>共 {rows.length} 项 · 每页50项</span><div><button type="button" className="button secondary small" disabled={current===1||locked} onClick={()=>setPage(current-1)}>上一页</button><span>{current} / {pages}</span><button type="button" className="button secondary small" disabled={current===pages||locked} onClick={()=>setPage(current+1)}>下一页</button></div></div>
   <footer><label className="confirmation-choice"><input type="checkbox" aria-label="确认规则导入变更" checked={confirmed} disabled={locked||!changes} onChange={e=>setConfirmed(e.target.checked)}/>{preview.counts.blocked?'我已核对变更，同意跳过需补齐或核对的项目':'我已核对以上新增和修改内容'}</label><div><button type="button" className="button secondary" disabled={locked} onClick={()=>void inspect(upload.file,upload.name)}>重新预览</button><button type="button" className="button primary" disabled={locked||!confirmed||!changes} onClick={()=>void apply()}><Check size={16}/>{changes?'确认导入 '+changes+' 项':'无需变更'}</button></div></footer>
  </section>}
 </div>;
}
