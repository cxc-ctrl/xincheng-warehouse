import {printNumber} from './print-recipes';
import {printJobLines,printBasis,type PrintJob,type NamedPrintRule,type PrintRuleLink,type PrintRuleMatch,type PrintData} from './printing';
import type {Product,OrderLine} from './model';
import {estimateLinkedPrinting} from './named-print-rules';

type DB=D1Database;type Statements=D1PreparedStatement[];
const text=(v:unknown,label:string,max=160)=>{if(typeof v!=='string'||v.length>max)throw new Error(label+'格式不正确');return v.trim();};
export async function readNamedPrintRules(d:DB,scope:string){const r=await d.batch([d.prepare('SELECT * FROM print_rules WHERE scope=? ORDER BY name,id').bind(scope),d.prepare('SELECT * FROM print_rule_links WHERE scope=? ORDER BY code').bind(scope),d.prepare('SELECT * FROM print_rule_matches WHERE scope=? ORDER BY shop,order_id,code').bind(scope)]);return {printRules:r[0].results as NamedPrintRule[],printRuleLinks:r[1].results as PrintRuleLink[],printRuleMatches:r[2].results as PrintRuleMatch[]};}
export async function namedPrintContext(d:DB,scope:string){return {...await readNamedPrintRules(d,scope),products:(await d.prepare('SELECT * FROM products WHERE scope=? ORDER BY code').bind(scope).all<Product>()).results};}
export function contextData(c:Awaited<ReturnType<typeof namedPrintContext>>):PrintData{return {printJobs:[],printCatalog:[],printEvents:[],...c};}
export function guardNamedEstimate(d:DB,scope:string,rid:string,guard:string,ss:Statements,lines:OrderLine[],c:Awaited<ReturnType<typeof namedPrintContext>>){
 const codes=new Set(lines.map(o=>o.code)),ids=new Set<string>();
 for(const code of codes){
  const product=c.products.find(p=>p.code===code),link=c.printRuleLinks.find(l=>l.code===code),match=c.printRuleMatches.find(m=>m.code===code&&m.shop===lines[0].shop&&m.order_id===lines[0].order_id);
  if((match??link)?.rule_id)ids.add((match??link)!.rule_id);
  for(const [table,where,args,version] of [
   ['products','code=?',[code],product?.updated_at??0],['print_rule_links','code=?',[code],link?.updated_at??0],['print_rule_matches','shop=? AND order_id=? AND code=?',[lines[0].shop,lines[0].order_id,code],match?.updated_at??0]
  ] as [string,string,string[],number][]){ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM ${table} WHERE scope=? AND ${where}),0)<>? THEN json('打印关联或商品资料已变化') ELSE 1 END`).bind(scope,rid,scope,...args,version));}
 }
 for(const id of ids){const rule=c.printRules.find(r=>r.id===id);ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_rules WHERE scope=? AND id=?),0)<>? THEN json('打印规则已变化') ELSE 1 END`).bind(scope,rid,scope,id,rule?.updated_at??0));}
}
function linkStatements(d:DB,scope:string,rid:string,guard:string,ss:Statements,assignments:Record<string,unknown>[],now:number){
 const json=JSON.stringify(assignments);
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM json_each(?) a JOIN product_supply_profiles p ON p.scope=? AND p.code=json_extract(a.value,'$.code') WHERE json_extract(p.config,'$.variant.print_rule_code')!='') THEN json('此SKU的打印参数由产品中心维护，请重新同步') ELSE 1 END`).bind(scope,rid,json,scope));
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND EXISTS(SELECT 1 FROM json_each(?) a LEFT JOIN print_rule_links l ON l.scope=? AND l.code=json_extract(a.value,'$.code') WHERE COALESCE(l.updated_at,0)<>json_extract(a.value,'$.updated_at') OR COALESCE(l.rule_id,'')<>json_extract(a.value,'$.expected_rule_id')) THEN json('SKU关联已变化，请刷新') ELSE 1 END`).bind(scope,rid,json,scope));
 ss.push(d.prepare(`DELETE FROM print_rule_links WHERE scope=? AND code IN(SELECT json_extract(value,'$.code') FROM json_each(?) WHERE json_extract(value,'$.rule_id') IS NULL) AND ${guard}`).bind(scope,json,scope,rid));
 ss.push(d.prepare(`INSERT INTO print_rule_links(scope,code,rule_id,per_pack_override,updated_at) SELECT ?,json_extract(value,'$.code'),json_extract(value,'$.rule_id'),json_extract(value,'$.per_pack_override'),? FROM json_each(?) WHERE json_extract(value,'$.rule_id') IS NOT NULL AND ${guard} ON CONFLICT(scope,code) DO UPDATE SET rule_id=excluded.rule_id,per_pack_override=excluded.per_pack_override,updated_at=excluded.updated_at`).bind(scope,now,json,scope,rid));
}
async function knownCodes(d:DB,scope:string){return new Set((await d.prepare('SELECT code FROM products WHERE scope=? UNION SELECT code FROM orders WHERE scope=? UNION SELECT code FROM print_catalog WHERE scope=?').bind(scope,scope,scope).all<{code:string}>()).results.map(r=>r.code));}
export async function appendNamedPrintAction(b:Record<string,any>,d:DB,scope:string,now:number,rid:string,ss:Statements,guard:string){
 if(b.action==='print_rule_save'){
  const raw=b.rule??{},id=text(raw.id,'规则编号',240);if(id.startsWith('pc:'))throw new Error('此打印规则由产品中心维护，请修改后重新同步');const name=text(raw.name,'打印产品名称',300),material=text(raw.material,'材质'),note=text(raw.note??'','备注',1000);if(!id||!name||!material)throw new Error('请填写打印产品名称和材质');
  const per=printNumber(raw.per_sheet,'可拼数量',true),weight=printNumber(raw.sheet_weight_g,'单张重量'),base=printNumber(raw.print_cost,'材料及打印价格'),lamination=printNumber(raw.lamination_cost,'覆膜价格'),flat=printNumber(raw.flat_cut_cost,'平板切割价格'),die=printNumber(raw.die_cut_cost,'普通模切价格');if(weight===0)throw new Error('单张重量须大于0，未知请留空');
  const cutting=raw.cutting??'none',laminated=cutting==='both'?1:raw.laminated??0,enabled=raw.enabled??1;if(![0,1].includes(laminated)||![0,1].includes(enabled)||!['none','flat','die','both'].includes(cutting))throw new Error('请选择有效加工方式和启用状态');
  if(cutting==='both'&&[lamination,flat,die].some(v=>v==null))throw new Error('请填写加工价格，不需要的工序填0');
  const old=await d.prepare('SELECT updated_at FROM print_rules WHERE scope=? AND id=?').bind(scope,id).first<{updated_at:number}>();if((old?.updated_at??0)!==raw.updated_at)throw new Error('打印规则已变化，请刷新');
  if(!Array.isArray(b.assignments)||b.assignments.length>5000)throw new Error('SKU关联列表无效');
  const known=await knownCodes(d,scope),seen=new Set<string>(),assignments=b.assignments.map((a:Record<string,any>)=>{const code=text(a.code,'SKU编码');if(!known.has(code)||seen.has(code))throw new Error('SKU不存在或重复：'+code);seen.add(code);if(a.rule_id!==id&&a.rule_id!==null)throw new Error('关联目标不正确');if(!Number.isSafeInteger(a.updated_at)||typeof a.expected_rule_id!=='string')throw new Error('请刷新SKU关联状态');return {code,rule_id:a.rule_id,per_pack_override:printNumber(a.per_pack_override,'每份个数',true),updated_at:a.updated_at,expected_rule_id:a.expected_rule_id};});
  const previous=(await d.prepare('SELECT code,updated_at FROM print_rule_links WHERE scope=? AND rule_id=? ORDER BY code').bind(scope,id).all<{code:string;updated_at:number}>()).results;
  if(JSON.stringify(previous)!==JSON.stringify(b.previous_links))throw new Error('规则下的SKU已变化，请刷新后重新选择');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_rules WHERE scope=? AND id=?),0)<>? THEN json('打印规则已变化') ELSE 1 END`).bind(scope,rid,scope,id,old?.updated_at??0));
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT json_group_array(json_object('code',code,'updated_at',updated_at)) FROM (SELECT code,updated_at FROM print_rule_links WHERE scope=? AND rule_id=? ORDER BY code)),'[]')<>? THEN json('规则关联已变化') ELSE 1 END`).bind(scope,rid,scope,id,JSON.stringify(previous)));
  ss.push(d.prepare(`INSERT INTO print_rules(scope,id,name,material,per_sheet,sheet_weight_g,print_cost,laminated,lamination_cost,cutting,flat_cut_cost,die_cut_cost,enabled,note,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO UPDATE SET name=excluded.name,material=excluded.material,per_sheet=excluded.per_sheet,sheet_weight_g=excluded.sheet_weight_g,print_cost=excluded.print_cost,laminated=excluded.laminated,lamination_cost=excluded.lamination_cost,cutting=excluded.cutting,flat_cut_cost=excluded.flat_cut_cost,die_cut_cost=excluded.die_cut_cost,enabled=excluded.enabled,note=excluded.note,updated_at=excluded.updated_at`).bind(scope,id,name,material,per,weight,base,laminated,lamination,cutting,flat,die,enabled,note,now,scope,rid));
  linkStatements(d,scope,rid,guard,ss,assignments,now);return true;
 }
 if(b.action!=='print_rule_match')return false;
 const shop=text(b.shop,'店铺'),id=text(b.order_id,'订单号'),job=await d.prepare('SELECT * FROM print_jobs WHERE scope=? AND shop=? AND order_id=?').bind(scope,shop,id).first<PrintJob>();if(!job||job.updated_at!==b.updated_at)throw new Error('打印任务已变化，请刷新');
 const lines=printJobLines(job,(await d.prepare('SELECT * FROM orders WHERE scope=? AND shop=? AND order_id=? ORDER BY key').bind(scope,shop,id).all<OrderLine&{updated_at:number}>()).results) as (OrderLine&{updated_at:number})[];if(!lines.length||printBasis(lines)!==b.basis)throw new Error('订单商品已变化，请刷新');
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>150||typeof b.remember!=='boolean')throw new Error('请选择需要匹配的商品和规则');
 const context=await namedPrintContext(d,scope),seen=new Set<string>(),assignments:Record<string,unknown>[]=[],matches:Record<string,unknown>[]=[];
 for(const raw of b.items){const code=text(raw.code,'SKU编码'),ruleId=text(raw.rule_id,'打印规则',240);if(await d.prepare("SELECT 1 FROM product_supply_profiles WHERE scope=? AND code=? AND COALESCE(json_extract(config,'$.variant.print_rule_code'),'')!=''").bind(scope,code).first())throw new Error('此SKU的打印参数由产品中心维护，请修改后同步');if(seen.has(code)||!lines.some(o=>o.code===code))throw new Error('匹配商品不属于此订单或重复');seen.add(code);const rule=context.printRules.find(r=>r.id===ruleId);if(!rule?.enabled)throw new Error('打印规则不存在或已停用');const per=printNumber(raw.per_pack_override,'每份个数',true),old=context.printRuleMatches.find(m=>m.shop===shop&&m.order_id===id&&m.code===code);
  if((old?.updated_at??0)!==raw.match_updated_at)throw new Error('本单匹配已变化，请刷新');
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM print_rules WHERE scope=? AND id=? AND updated_at=? AND enabled=1) THEN json('打印规则已变化') ELSE 1 END`).bind(scope,rid,scope,ruleId,rule.updated_at));
  ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM print_rule_matches WHERE scope=? AND shop=? AND order_id=? AND code=?),0)<>? THEN json('本单匹配已变化') ELSE 1 END`).bind(scope,rid,scope,shop,id,code,old?.updated_at??0));
  if(b.remember)assignments.push({code,rule_id:ruleId,per_pack_override:per,updated_at:raw.link_updated_at,expected_rule_id:raw.expected_rule_id});else matches.push({code,rule_id:ruleId,per_pack_override:per});
 }
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM print_jobs WHERE scope=? AND shop=? AND order_id=? AND updated_at=?) THEN json('打印任务已变化') ELSE 1 END`).bind(scope,rid,scope,shop,id,job.updated_at));
 for(const o of lines)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=? AND key=? AND updated_at=?) THEN json('订单商品已变化') ELSE 1 END`).bind(scope,rid,scope,o.key,o.updated_at));
 if(b.remember){if(assignments.some(a=>!Number.isSafeInteger(a.updated_at)||typeof a.expected_rule_id!=='string'))throw new Error('请刷新SKU关联状态');linkStatements(d,scope,rid,guard,ss,assignments,now);ss.push(d.prepare(`DELETE FROM print_rule_matches WHERE scope=? AND shop=? AND order_id=? AND code IN(SELECT json_extract(value,'$.code') FROM json_each(?)) AND ${guard}`).bind(scope,shop,id,JSON.stringify(assignments),scope,rid));}
 else for(const m of matches)ss.push(d.prepare(`INSERT INTO print_rule_matches(scope,shop,order_id,code,rule_id,per_pack_override,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,shop,order_id,code) DO UPDATE SET rule_id=excluded.rule_id,per_pack_override=excluded.per_pack_override,updated_at=excluded.updated_at`).bind(scope,shop,id,m.code,m.rule_id,m.per_pack_override,now,scope,rid));
 ss.push(d.prepare(`UPDATE print_jobs SET updated_at=? WHERE scope=? AND shop=? AND order_id=? AND ${guard}`).bind(now,scope,shop,id,scope,rid));
 ss.push(d.prepare(`INSERT INTO print_events(scope,id,shop,order_id,action,note,at) SELECT ?,?,?,?,'匹配打印规则',?,? WHERE ${guard}`).bind(scope,crypto.randomUUID(),shop,id,'匹配 '+b.items.length+' 个SKU；'+(b.remember?'同时记住SKU关联':'仅用于本单'),now,scope,rid));return true;
}
