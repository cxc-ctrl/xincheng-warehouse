import type {DigitVariant} from './digit-colors';
export type DigitCondition={color:string;size:number;start:number;end:number;out_of_range:string;shortage:string;print_rule_id:string;enabled:number;updated_at:number};
const actions=['建议整单打印','人工核对'];
export async function readDigitConditions(d:D1Database,scope:string){
 const stored=(await d.prepare('SELECT color,size,start,end,out_of_range,shortage,print_rule_id,enabled,updated_at FROM warehouse_digit_conditions WHERE scope=? ORDER BY size,color').bind(scope).all<DigitCondition>()).results;
 const defaults=(await d.prepare('SELECT color,size,MIN(start) AS start,MIN(available_end) AS end FROM digit_stock_variants WHERE scope=? GROUP BY color,size ORDER BY size,color').bind(scope).all<Pick<DigitCondition,'color'|'size'|'start'|'end'>>()).results;
 return mergeDigitConditions(stored,defaults);
}
export function mergeDigitConditions(stored:DigitCondition[],defaults:Pick<DigitCondition,'color'|'size'|'start'|'end'>[]){
 return [...stored,...defaults.filter(v=>!stored.some(c=>c.color===v.color&&c.size===v.size)).map(v=>({...v,out_of_range:'人工核对',shortage:'人工核对',print_rule_id:'',enabled:1,updated_at:0}))].sort((a,b)=>a.size-b.size||a.color.localeCompare(b.color,'zh-CN'));
}
const guardedImports=new WeakSet<D1PreparedStatement[]>();
export async function guardDigitConditions(d:D1Database,ss:D1PreparedStatement[],scope:string,rid:string,guard:string){
 if(guardedImports.has(ss))return;guardedImports.add(ss);
 const rows=(await d.prepare('SELECT color,size,updated_at FROM warehouse_digit_conditions WHERE scope=?').bind(scope).all<DigitCondition>()).results;
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (SELECT COUNT(*) FROM warehouse_digit_conditions WHERE scope=?)<>? THEN json('数字贴条件已变化，请刷新重试') ELSE 1 END`).bind(scope,rid,scope,rows.length));
 for(const c of rows)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM warehouse_digit_conditions WHERE scope=? AND color=? AND size=? AND updated_at=?) THEN json('数字贴条件已变化，请刷新重试') ELSE 1 END`).bind(scope,rid,scope,c.color,c.size,c.updated_at));
}
export async function appendDigitConditionAction(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='warehouse_digit_condition')return false;
 const r=b.condition??{},color=typeof r.color==='string'?r.color.trim():'',size=r.size,start=r.start,end=r.end;
 if(!color||color.length>160||/[\r\n]/.test(color)||!Number.isFinite(size)||size<=0||size>1000||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>100000||!actions.includes(r.out_of_range)||!actions.includes(r.shortage)||![0,1].includes(r.enabled))throw new Error('请填写颜色、尺寸、有效数字范围和处理方式');
 const rule=typeof r.print_rule_id==='string'?r.print_rule_id:'';
 if(rule&&!await d.prepare('SELECT 1 FROM print_rules WHERE scope=? AND id=? AND enabled=1').bind(scope,rule).first())throw new Error('请选择启用的仓库打印规则');
 const old=await d.prepare('SELECT updated_at FROM warehouse_digit_conditions WHERE scope=? AND color=? AND size=?').bind(scope,color,size).first<{updated_at:number}>();
 if((old?.updated_at??0)!==r.updated_at)throw new Error('数字贴条件已被修改，请刷新后重试');
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM warehouse_digit_conditions WHERE scope=? AND color=? AND size=?),0)<>? THEN json('数字贴条件已被修改') ELSE 1 END`).bind(scope,rid,scope,color,size,r.updated_at));
 ss.push(d.prepare(`INSERT INTO warehouse_digit_conditions(scope,color,size,start,end,out_of_range,shortage,print_rule_id,enabled,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,color,size) DO UPDATE SET start=excluded.start,end=excluded.end,out_of_range=excluded.out_of_range,shortage=excluded.shortage,print_rule_id=excluded.print_rule_id,enabled=excluded.enabled,updated_at=excluded.updated_at`).bind(scope,color,size,start,end,r.out_of_range,r.shortage,rule,r.enabled,now,scope,rid));
 return true;
}
