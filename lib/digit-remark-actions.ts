import {DEFAULT_REMARK_RULES,literalRemark,type DigitRemarkRule} from './digit-remark-rules';
import {COLOR_NAMES,remarkColor} from './digit-colors';
export type RemarkRuleRow={id:string;payload:string;updated_at:number};
export function mergeRemarkRules(stored:RemarkRuleRow[]){
 const merged=new Map(DEFAULT_REMARK_RULES.map(r=>[r.id,{...r,keywords:[...r.keywords],exclude_keywords:[...r.exclude_keywords]}]));
 for(const row of stored)merged.set(row.id,{...JSON.parse(row.payload),id:row.id,updated_at:row.updated_at});
 return [...merged.values()];
}
export async function readRemarkRules(d:D1Database,scope:string){
 const stored=(await d.prepare('SELECT id,payload,updated_at FROM digit_remark_rules WHERE scope=? ORDER BY id').bind(scope).all<RemarkRuleRow>()).results;
 return mergeRemarkRules(stored);
}
const guardedImports=new WeakSet<D1PreparedStatement[]>();
export async function guardRemarkRules(d:D1Database,ss:D1PreparedStatement[],scope:string,rid:string,guard:string){
 if(guardedImports.has(ss))return;guardedImports.add(ss);
 const q="SELECT COALESCE(group_concat(id||':'||updated_at,'|'),'') AS version FROM (SELECT id,updated_at FROM digit_remark_rules WHERE scope=? ORDER BY id)";
 const old=await d.prepare(q).bind(scope).first<{version:string}>();
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (${q.replace(' AS version','')})<>? THEN json('备注规则已变化，请重新识别') ELSE 1 END`).bind(scope,rid,scope,old!.version));
}
function text(v:unknown,max:number){if(typeof v!=='string'||v.length>max)throw new Error('规则字段格式或长度不正确');return v.trim();}
export function validateRemarkRule(raw:any):DigitRemarkRule{
 const id=text(raw.id,100),name=text(raw.name,80);
 if(!id||!/^[a-zA-Z0-9_-]+$/.test(id)||!name)throw new Error('请填写规则名称');
 const words=(value:unknown,required:boolean)=>{if(!Array.isArray(value)||value.length>30)throw new Error('每项最多填写30个关键词');const list=[...new Set(value.map(k=>text(k,60)).filter(Boolean))];if(required&&!list.length||list.some(k=>literalRemark(k).length<2))throw new Error('关键词至少2个字符，每行一个');return list;};
 const keywords=words(raw.keywords,true),exclude_keywords=words(raw.exclude_keywords??[],false);
 if(!['buyer','seller','both'].includes(raw.source)||!['color','review','print'].includes(raw.action)||![0,1].includes(raw.enabled))throw new Error('请选择适用备注、处理方式和状态');
 const size=raw.size_cm==null||raw.size_cm===''?null:Number(raw.size_cm);if(size!=null&&(!Number.isFinite(size)||size<=0||size>1000))throw new Error('尺寸须为有效厘米数，留空适用全部尺寸');
 const color=raw.action==='color'?text(raw.color??'',80):'';if(raw.action==='color'&&!COLOR_NAMES.includes(color))throw new Error('请选择已有数字贴颜色');
 if(keywords.some(k=>COLOR_NAMES.some(c=>literalRemark(k)===literalRemark(c)&&c!==color))&&raw.action==='color')throw new Error('不能把一个完整颜色名称改成另一种颜色；请填写简称或别名');
 const updated_at=raw.updated_at??0;if(!Number.isSafeInteger(updated_at)||updated_at<0)throw new Error('规则版本无效，请刷新');
 return {id,name,keywords,exclude_keywords,source:raw.source,size_cm:size,action:raw.action,color,enabled:raw.enabled,updated_at};
}
export async function appendRemarkRule(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='digit_remark_rule')return false;const value=validateRemarkRule(b.rule),rules=await readRemarkRules(d,scope),old=rules.find(r=>r.id===value.id);
 if((old?.updated_at??0)!==value.updated_at)throw new Error('规则已被修改，请刷新后重试');if(!old&&rules.length>=100)throw new Error('最多建立100条备注规则');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM digit_remark_rules WHERE scope=? AND id=?),0)<>? THEN json('备注规则已变化') ELSE 1 END`).bind(scope,rid,scope,value.id,value.updated_at));
 ss.push(d.prepare(`INSERT INTO digit_remark_rules(scope,id,payload,updated_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(scope,value.id,JSON.stringify(value),Math.max(now,value.updated_at+1),scope,rid));return true;
}
export async function previewRemark(d:D1Database,scope:string,b:Record<string,any>){
 const raw=b.order??{},quantity=raw.quantity;if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>1000000)throw new Error('请填写有效购买份数');
 const order={title:text(raw.title??'数字贴',1000),spec:text(raw.spec??'',1000),quantity,buyer_remark:text(raw.buyer_remark??'',4000),seller_remark:text(raw.seller_remark??'',4000),remarks_available:raw.remarks_available!==false} as Parameters<typeof remarkColor>[0];
 return remarkColor(order,COLOR_NAMES,await readRemarkRules(d,scope));
}
