'use client';
import {useState} from 'react';
import {REMARK_STANDARD_GROUPS,REMARK_STANDARDS,type RemarkExample} from '../lib/digit-remark-standards';
import {REMARK_ACTIONS,type DigitRemarkRule} from '../lib/digit-remark-rules';
type Props={rules:DigitRemarkRule[];busy:boolean;onEdit:(rule:DigitRemarkRule)=>void;onSupplement:(color:string)=>void;onExample:(example:RemarkExample)=>void};
export default function DigitRemarkStandards({rules,busy,onEdit,onSupplement,onExample}:Props){
 const [group,setGroup]=useState<string>('全部'),[search,setSearch]=useState('');
 const query=search.trim().toLowerCase(),filtered=REMARK_STANDARDS.filter(r=>(group==='全部'||r.group===group)&&[r.name,r.when,r.result,r.detail,r.example?.buyer,r.example?.seller,r.color].join(' ').toLowerCase().includes(query));
 return <section className="panel print-pad remark-existing">
  <div className="print-toolbar"><div><h2>原有备注识别标准</h2><p className="print-note">把原来已在使用的判断逐条列在这里。先读备注、识别颜色与份数，再核对库存条件。</p></div><span className="remark-standard-count">{REMARK_STANDARDS.length} 项原有标准</span></div>
  <div className="remark-standard-flow" aria-label="备注识别顺序"><span>买家 / 卖家备注</span><span>→</span><span>颜色与购买份数</span><span>→</span><span>范围、版面与库存</span><span>→</span><span>扣库 / 人工处理</span></div>
  <div className="remark-standard-filters"><div className="remark-standard-groups" aria-label="筛选原有标准">{REMARK_STANDARD_GROUPS.map(g=><button type="button" key={g} aria-pressed={group===g} onClick={()=>setGroup(g)}>{g}</button>)}</div><input aria-label="搜索原有识别标准" placeholder="搜索颜色、数量、备注要求…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
  <div className="remark-standard-scroll" tabIndex={0} aria-label="原有备注识别标准清单"><table className="remark-standard-table"><thead><tr><th>规则 / 适用环节</th><th>触发条件或已有说法</th><th>处理结果</th><th>查看 / 配置</th></tr></thead><tbody>{filtered.map(r=>{
   const editable=rules.find(rule=>rule.id===r.editRuleId);
   return <tr key={r.id}><td><strong>{r.name}</strong><small>{r.group}</small></td><td>{editable?<><div className="remark-tags">{editable.keywords.map(k=><span key={k}>{k}</span>)}</div><small>{editable.enabled?'当前已启用':'当前已停用'}{editable.exclude_keywords.length?'；排除：'+editable.exclude_keywords.join('、'):''}</small></>:r.when}</td><td>{editable?(editable.enabled?REMARK_ACTIONS[editable.action]+(editable.action==='color'?'：'+editable.color:''):'本条关键词规则已停用'):r.result}<details><summary>说明{r.example?'与例子':''}</summary><p>{r.detail}</p>{r.example&&<p className="remark-standard-example">{r.example.seller&&<>卖家：{r.example.seller}<br/></>}买家：{r.example.buyer}<br/>购买：{r.example.quantity??1}份 · 规格：{r.example.spec??'15cm 1-100'}</p>}</details></td><td><div className="remark-standard-actions">{editable&&<button type="button" className="text-btn" disabled={busy} onClick={()=>onEdit(editable)}>编辑关键词</button>}{r.color&&<button type="button" className="text-btn" disabled={busy} onClick={()=>onSupplement(r.color!)}>补充说法</button>}{r.example&&<button type="button" className="text-btn" onClick={()=>onExample(r.example!)}>填入试算</button>}{!editable&&!r.color&&<small>自动校验</small>}</div></td></tr>;
  })}</tbody></table>{!filtered.length&&<p className="print-note">没有找到对应标准，请调整搜索条件。</p>}</div>
  <p className="print-note remark-standard-foot">当前显示 {filtered.length} 项。关键词可在下方新增或编辑；自动校验说明后台已有判断，不能用关键词跳过数量矛盾和库存检查。例子使用当前已保存规则试算，结果以实际试算为准。</p>
 </section>;
}
