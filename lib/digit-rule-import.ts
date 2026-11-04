import {validateRemarkRule,mergeRemarkRules,type RemarkRuleRow} from './digit-remark-actions';
import {COMPATIBLE_REMARK_STANDARDS_VERSIONS} from './digit-remark-standards';
import {mergeDigitConditions,type DigitCondition} from './warehouse-digit-conditions';
import {COLOR_NAMES,type DigitVariant} from './digit-colors';
import type {DigitRemarkRule} from './digit-remark-rules';
import type {NamedPrintRule,PrintRuleLink} from './printing';
import type {StockRule} from './model';

type Obj=Record<string,any>;
export type DigitImportRow={kind:string;key:string;name:string;status:'add'|'update'|'same'|'blocked';before:string;after:string;reason:string};
export type DigitImportPreview={token:string;exported_at:string;rows:DigitImportRow[];counts:{add:number;update:number;same:number;blocked:number};notes:string[]};
const txt=(v:unknown,label:string,max=160)=>{if(typeof v!=='string'||v.length>max||/[\r\n]/.test(v))throw new Error(label+'格式不正确');return v.trim();};
const key=(v:unknown,label:string,max=160)=>{const s=txt(v,label,max);if(!s)throw new Error('缺少'+label);return s;};
const integer=(v:unknown,label:string,min=1,max=100000)=>{if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new Error(label+'须为有效整数');return Number(v);};
const decimal=(v:unknown,label:string,positive=false)=>{if(v==null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<(positive?Number.MIN_VALUE:0)||v>100000000)throw new Error(label+'格式不正确');return v;};
function readNote(v:unknown){if(v==null)return '';if(typeof v!=='string'||v.length>1000)throw new Error('打印备注格式不正确');return v;}
function array(v:unknown,label:string,max:number){if(v==null)return [];if(!Array.isArray(v)||v.length>max||v.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new Error(label+'格式不正确或条数过多');return v as Obj[];}
function unique<T>(rows:T[],get:(r:T)=>string,label:string){const seen=new Set<string>();for(const r of rows){const k=get(r);if(seen.has(k))throw new Error(label+'重复：'+k);seen.add(k);}return rows;}
const conditionKey=(r:Pick<DigitCondition,'color'|'size'>)=>JSON.stringify([r.color,r.size]);
const variantKey=(r:Pick<DigitVariant,'base_code'|'color'>)=>JSON.stringify([r.base_code,r.color]);
const plain=(r:Obj,fields:string[])=>Object.fromEntries(fields.map(f=>[f,r[f]??null]));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const remarkFields=['id','name','keywords','exclude_keywords','source','size_cm','action','color','enabled'];
const conditionFields=['color','size','start','end','out_of_range','shortage','print_rule_id','enabled'];
const printFields=['id','name','material','per_sheet','sheet_weight_g','print_cost','laminated','lamination_cost','cutting','flat_cut_cost','die_cut_cost','enabled','note'];
const variantFields=['base_code','color','stock_code','size','start','end','available_end'];
const printLinkFields=['code','rule_id','per_pack_override'];

export function normalizeDigitRuleFile(raw:unknown){
 const file=raw as Obj;if(!file||file.format!=='warehouse-digit-rules'||file.schema_version!==1)throw new Error('请选择本系统导出的数字贴规则JSON文件（版本1）');
 if(file.engine?.id!=='digit-remark-parser'||!COMPATIBLE_REMARK_STANDARDS_VERSIONS.has(file.engine?.standards_version))throw new Error('规则基础版本与当前系统不兼容，请先核对版本');
 const keywords=unique(array(file.keyword_rules,'关键词规则',100).map(r=>validateRemarkRule({...r,updated_at:0})),r=>r.id,'关键词规则编号');
 const conditions=unique(array(file.stock_conditions,'备货条件',2000).map(r=>{
  const color=key(r.color,'条件颜色'),size=decimal(r.size,'尺寸',true);if(size==null||size>1000)throw new Error('条件尺寸不正确');
  const start=integer(r.start,'起号'),end=integer(r.end,'止号');if(end<start)throw new Error('止号不能小于起号');
  if(!['人工核对','建议整单打印'].includes(r.out_of_range)||!['人工核对','建议整单打印'].includes(r.shortage)||![0,1].includes(r.enabled))throw new Error('备货条件的处理方式或状态不正确');
  return {color,size,start,end,out_of_range:r.out_of_range,shortage:r.shortage,print_rule_id:txt(r.print_rule_id??'','打印规则编号',240),enabled:r.enabled,updated_at:0} as DigitCondition;
 }),conditionKey,'备货条件');
 const variants=unique(array(file.digit_variants,'数字版面',5000).map(r=>{
  const color=key(r.color,'版面颜色');if(!COLOR_NAMES.includes(color))throw new Error('不支持的数字贴颜色：'+color);
  const start=integer(r.start,'版面起号'),end=integer(r.end,'版面止号');if(end<start)throw new Error('版面范围不正确');
  const size=decimal(r.size,'版面尺寸',true);if(size==null||size>1000)throw new Error('版面尺寸不正确');
  return {base_code:key(r.base_code,'基础实物编码'),stock_code:key(r.stock_code,'颜色实物编码'),color,size,start,end,available_end:integer(r.available_end,'可用止号')} as DigitVariant;
 }),variantKey,'数字版面');
 const stockLinks=unique(array(file.sales_stock_links,'销售库存关联',12000).map(r=>({sales_code:key(r.sales_code,'销售SKU'),stock_code:key(r.stock_code,'实物编码'),per_unit:integer(r.per_unit,'每份扣减量',1,100000000)})),r=>JSON.stringify([r.sales_code,r.stock_code]),'销售库存关联');
 const printRules=unique(array(file.referenced_print_rules,'打印规则',1000).map(r=>{
  if(![0,1].includes(r.enabled)||![0,1].includes(r.laminated)||!['none','flat','die','both'].includes(r.cutting))throw new Error('打印加工方式或状态不正确');
  return {id:key(r.id,'打印规则编号',240),name:key(r.name,'打印规则名称',300),material:txt(r.material??'','打印材质'),per_sheet:r.per_sheet==null?null:integer(r.per_sheet,'可拼数量',1,100000000),sheet_weight_g:decimal(r.sheet_weight_g,'单张重量',true),print_cost:decimal(r.print_cost,'打印价格'),laminated:r.laminated,lamination_cost:decimal(r.lamination_cost,'覆膜价格'),cutting:r.cutting,flat_cut_cost:decimal(r.flat_cut_cost,'平板切割价格'),die_cut_cost:decimal(r.die_cut_cost,'模切价格'),enabled:r.enabled,note:readNote(r.note),updated_at:0} as NamedPrintRule;
 }),r=>r.id,'打印规则');
 const printLinks=unique(array(file.referenced_print_links,'打印SKU关联',5000).map(r=>({code:key(r.code,'打印销售SKU'),rule_id:key(r.rule_id,'关联打印规则',240),per_pack_override:r.per_pack_override==null?null:integer(r.per_pack_override,'每份个数',1,100000000),updated_at:0})),r=>r.code,'打印SKU关联');
 const physicalRefs=unique(array(file.physical_stock_references,'实物参照',6000).map(r=>({code:key(r.code,'参照实物编码'),unit:key(r.unit,'参照实物单位')})),r=>r.code,'实物参照');
 const salesRefs=unique(array(file.sales_product_references,'销售参照',5000).map(r=>({code:key(r.code,'参照销售SKU'),spec:txt(r.spec??'','销售规格',1000)})),r=>r.code,'销售参照');
 if(!keywords.length&&!conditions.length&&!variants.length&&!stockLinks.length&&!printRules.length&&!printLinks.length)throw new Error('文件中没有可导入的规则配置');
 return {keywords,conditions,variants,stockLinks,printRules,printLinks,physicalRefs,salesRefs,exported_at:typeof file.exported_at==='string'?file.exported_at.slice(0,80):''};
}

// JSON snapshots are selected in a single read transaction and reused verbatim
// as transaction guards. They prevent changes between preview and application.
const tables=[
 ['digit_remark_rules','id,payload,updated_at','id'],
 ['warehouse_digit_conditions','color,size,start,end,out_of_range,shortage,print_rule_id,enabled,updated_at','color,size'],
 ['digit_stock_variants',variantFields.join(','),'base_code,color'],
 ['stock_rules','sales_code,stock_code,per_unit','sales_code,stock_code'],
 ['products','code,name,spec,stock_mode,recipe_at,tracking_enabled,quantity,count_at,updated_at','code'],
 ['physical_stocks','code,name,unit,archived,quantity,count_at,updated_at','code'],
 ['print_rules',printFields.join(',')+',updated_at','id'],
 ['print_rule_links','code,rule_id,per_pack_override,updated_at','code'],
 ['product_supply_profiles','code,config','code'],
 ['retired_recipes','sales_code,retired_at','sales_code'],
] as const;
const queries=tables.map(([table,columns,order])=>`SELECT COALESCE(json_group_array(json_object(${columns.split(',').map(c=>`'${c}',${c}`).join(',')})),'[]') AS value FROM (SELECT ${columns} FROM ${table} WHERE scope=? ORDER BY ${order})`);
const usedSalesQuery="SELECT COALESCE(json_group_array(code),'[]') AS value FROM (SELECT code FROM orders WHERE scope=? AND deducted_qty>0 UNION SELECT sales_code AS code FROM order_stocks WHERE scope=? AND deducted_qty>0 ORDER BY code)";
const usedStocksQuery="SELECT COALESCE(json_group_array(stock_code),'[]') AS value FROM (SELECT DISTINCT stock_code FROM order_stocks WHERE scope=? AND deducted_qty>0 ORDER BY stock_code)";
async function context(d:D1Database,scope:string){const all=[...queries,usedSalesQuery,usedStocksQuery],result=await d.batch(all.map((q,i)=>d.prepare(q).bind(...(i===queries.length?[scope,scope]:[scope]))));const raw=result.map(r=>(r.results[0] as {value:string}).value);return {all,raw,rows:raw.map(s=>JSON.parse(s) as Obj[])};}
async function digest(v:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function planImport(d:D1Database,scope:string,raw:unknown){
 const f=normalizeDigitRuleFile(raw),ctx=await context(d,scope),[storedRemarks,storedConditions,variants,stockLinks,products,stocks,printRules,printLinks,profiles,,usedSales,usedStocks]=ctx.rows;
 const keywords=mergeRemarkRules(storedRemarks as RemarkRuleRow[]),defaults=new Map<string,Obj>();for(const v of variants){const k=conditionKey(v as DigitCondition),old=defaults.get(k);defaults.set(k,{color:v.color,size:v.size,start:Math.min(v.start,old?.start??v.start),end:Math.min(v.available_end,old?.end??v.available_end)});}
 const conditions=mergeDigitConditions(storedConditions as DigitCondition[],[...defaults.values()] as DigitCondition[]);
 const used=new Set(usedSales as unknown as string[]),usedStock=new Set(usedStocks as unknown as string[]),rows:DigitImportRow[]=[];
 const changes={keywords:[] as DigitRemarkRule[],conditions:[] as DigitCondition[],variants:[] as DigitVariant[],recipes:[] as {code:string;items:StockRule[]}[],printRules:[] as NamedPrintRule[],printLinks:[] as PrintRuleLink[]};
 const describe=(v:unknown)=>v==null?'未建立':JSON.stringify(v);
 function add(kind:string,k:string,name:string,old:Obj|undefined,next:Obj,fields:string[],reason=''){
  const before=old?plain(old,fields):null,after=plain(next,fields),status=reason&&/缺少|缺失|已移除|单位不一致/.test(reason)?'blocked':old&&same(before,after)?'same':reason?'blocked':old?'update':'add';
  rows.push({kind,key:k,name,status,before:describe(before),after:describe(after),reason:status==='same'?'当前配置相同':reason});return status==='add'||status==='update';
 }
 const canUseStock=(code:string)=>{const stock=stocks.find(s=>s.code===code),ref=f.physicalRefs.find(s=>s.code===code);return !stock?'缺少实物：'+code:stock.archived?'实物已移除：'+code:ref&&ref.unit!==stock.unit?'实物单位不一致：'+code:'';};
 const ownership=(code:string,printing=false)=>{const profile=profiles.find(p=>p.code===code);if(!profile)return '';const cfg=JSON.parse(profile.config);return printing?(cfg.variant?.print_rule_code?'打印关联由产品中心维护，请先同步':''):(cfg.digit_rules_owner==='warehouse'?'':'库存关联由产品中心维护，请先同步');};
 if(new Set([...keywords.map(r=>r.id),...f.keywords.map(r=>r.id)]).size>100)throw new Error('合并后关键词规则超过100条，请先整理');
 for(const r of f.keywords)if(add('关键词规则',r.id,r.name,keywords.find(v=>v.id===r.id),r,remarkFields))changes.keywords.push(r);
 const eligiblePrints=new Map(printRules.map(r=>[r.id,r]));
 for(const r of f.printRules){const old=printRules.find(v=>v.id===r.id);const blocked=r.id.startsWith('pc:')?'产品中心打印规则不能由规则文件覆盖，请先同步':'';if(add('关联打印规则',r.id,r.name,old,r,printFields,blocked)){changes.printRules.push(r);eligiblePrints.set(r.id,r);}}
 for(const r of f.conditions){const old=conditions.find(v=>conditionKey(v)===conditionKey(r)),target=eligiblePrints.get(r.print_rule_id);const blocked=r.print_rule_id&&(!target||!target.enabled)?'对应打印规则缺失或停用：'+r.print_rule_id:'';if(add('数字贴条件',conditionKey(r),r.color+' '+r.size+'cm',old,r,conditionFields,blocked))changes.conditions.push(r);}
 const blockedVariantBases=new Set<string>();
 const eligibleVariants=new Map(variants.map(r=>[variantKey(r as DigitVariant),r]));
 for(const r of f.variants){const old=variants.find(v=>variantKey(v as DigitVariant)===variantKey(r));const blocked=canUseStock(r.base_code)||canUseStock(r.stock_code)||([r.base_code,r.stock_code,old?.stock_code].some(c=>usedStock.has(c))?'该版面已有历史扣减，变更需人工核对':'');if(add('数字版面',variantKey(r),r.color+' '+r.size+'cm '+r.start+'～'+r.end,old,r,variantFields,blocked)){changes.variants.push(r);eligibleVariants.set(variantKey(r),r);}if(rows.at(-1)?.status==='blocked')blockedVariantBases.add(r.base_code);}
 const digitCodes=new Set([...eligibleVariants.values()].flatMap(v=>[v.base_code,v.stock_code])),groups=new Map<string,StockRule[]>();for(const r of f.stockLinks){const a=groups.get(r.sales_code)??[];a.push(r as StockRule);groups.set(r.sales_code,a);}
 for(const [code,items] of groups){const product=products.find(p=>p.code===code),old=stockLinks.filter(r=>r.sales_code===code),ref=f.salesRefs.find(r=>r.code===code);const nonDigit=old.filter(r=>!variants.some(v=>v.base_code===r.stock_code||v.stock_code===r.stock_code));const next=[...items,...nonDigit.filter(r=>!items.some(i=>i.stock_code===r.stock_code))].sort((a,b)=>a.stock_code.localeCompare(b.stock_code));
  let blocked=!product?'缺少销售SKU：'+code:product.tracking_enabled===0?'此SKU已停用库存管理':ownership(code)||canUseStock(items.find(r=>canUseStock(r.stock_code))?.stock_code??items[0].stock_code);
  if(!blocked&&items.some(r=>!digitCodes.has(r.stock_code)||blockedVariantBases.has(r.stock_code)))blocked='关联版面未恢复，请先补齐实物和版面';
  if(!blocked&&product&&(product.quantity!=null||product.count_at!=null)&&product.stock_mode!=='recipe')blocked='已有独立成品盘点，不能改为共用库存';
  if(!blocked&&product&&ref?.spec&&product.spec&&ref.spec.normalize('NFKC').replace(/\s/g,'')!==product.spec.normalize('NFKC').replace(/\s/g,''))blocked='销售规格与备份不一致，请人工核对';
  const before=old.map(r=>plain(r,['stock_code','per_unit'])).sort((a,b)=>String(a.stock_code).localeCompare(String(b.stock_code))),after=next.map(r=>plain(r,['stock_code','per_unit']));const unchanged=product?.stock_mode==='recipe'&&same(before,after);
  if(!blocked&&used.has(code)&&!unchanged)blocked='已有历史扣减，不能覆盖关联';
  const status=unchanged?'same':blocked?'blocked':old.length?'update':'add';rows.push({kind:'销售库存关联',key:code,name:product?.name??code,status,before:describe(before),after:describe(after),reason:unchanged?'当前配置相同':blocked});if(status==='add'||status==='update')changes.recipes.push({code,items:next as StockRule[]});
 }
 for(const r of f.printLinks){const old=printLinks.find(v=>v.code===r.code),target=eligiblePrints.get(r.rule_id);const blocked=!products.some(p=>p.code===r.code)?'缺少销售SKU：'+r.code:ownership(r.code,true)||(!target||!target.enabled?'对应打印规则缺失或停用：'+r.rule_id:'');if(add('打印SKU关联',r.code,r.code,old,r,printLinkFields,blocked))changes.printLinks.push(r);}
 const counts={add:0,update:0,same:0,blocked:0};for(const r of rows)counts[r.status]++;
 const token=await digest([f,ctx.raw]);const preview:DigitImportPreview={token,exported_at:f.exported_at,rows,counts,notes:['采用合并恢复：文件中没有的现有规则继续保留。','“需补齐 / 核对”的项目会跳过；补齐商品或实物后可再次导入同一文件。','基础识别标准由系统版本执行，文件中的说明不作为程序导入。','仅更新规则及未产生历史扣减的关联；不新建商品、不填写库存、不重算历史订单或已确认成本。']};
 return {ctx,changes,preview};
}
export async function previewDigitRuleImport(d:D1Database,scope:string,file:unknown){return (await planImport(d,scope,file)).preview;}
export async function appendDigitRuleImport(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.action!=='digit_rules_import')return false;if(b.confirm!==true)throw new Error('请先预览并确认导入内容');
 const plan=await planImport(d,scope,b.file);if(plan.preview.token!==b.preview_token)throw new Error('规则或关联数据已变化，请重新预览后导入');
 if(plan.preview.counts.blocked&&b.skip_blocked!==true)throw new Error('存在待补齐项目，请确认跳过后再导入');
 for(let i=0;i<plan.ctx.all.length;i++)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (${plan.ctx.all[i].replace(' AS value','')})<>? THEN json('规则导入预览已过期，请重新预览') ELSE 1 END`).bind(scope,rid,...(i===queries.length?[scope,scope]:[scope]),plan.ctx.raw[i]));
 const change=plan.changes;
 function upsert(table:string,cols:string[],pk:string[],records:Obj[]){if(!records.length)return;const updates=cols.filter(c=>!pk.includes(c));ss.push(d.prepare(`INSERT INTO ${table}(scope,${cols.join(',')}) SELECT ?,${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE ${guard} ON CONFLICT(scope,${pk.join(',')}) DO UPDATE SET ${updates.map(c=>`${c}=excluded.${c}`).join(',')}`).bind(scope,JSON.stringify(records),scope,rid));}
 upsert('digit_remark_rules',['id','payload','updated_at'],['id'],change.keywords.map(r=>({id:r.id,payload:JSON.stringify({...r,updated_at:now}),updated_at:Math.max(now,(plan.ctx.rows[0].find(s=>s.id===r.id)?.updated_at??0)+1)})));
 upsert('print_rules',[...printFields,'updated_at'],['id'],change.printRules.map(r=>({...r,updated_at:Math.max(now,(plan.ctx.rows[6].find(v=>v.id===r.id)?.updated_at??0)+1)})));
 upsert('warehouse_digit_conditions',[...conditionFields,'updated_at'],['color','size'],change.conditions.map(r=>({...r,updated_at:Math.max(now,(plan.ctx.rows[1].find(v=>conditionKey(v as DigitCondition)===conditionKey(r))?.updated_at??0)+1)})));
 upsert('digit_stock_variants',variantFields,['base_code','color'],change.variants);
 if(change.recipes.length){const codes=JSON.stringify(change.recipes.map(r=>({code:r.code})));ss.push(d.prepare(`DELETE FROM stock_rules WHERE scope=? AND sales_code IN(SELECT json_extract(value,'$.code') FROM json_each(?)) AND ${guard}`).bind(scope,codes,scope,rid));
  upsert('stock_rules',['sales_code','stock_code','per_unit'],['sales_code','stock_code'],change.recipes.flatMap(r=>r.items.map(i=>({...i,sales_code:r.code}))));
  ss.push(d.prepare(`UPDATE products SET stock_mode='recipe',recipe_at=?,updated_at=? WHERE scope=? AND code IN(SELECT json_extract(value,'$.code') FROM json_each(?)) AND ${guard}`).bind(now,now,scope,codes,scope,rid));
  ss.push(d.prepare(`DELETE FROM retired_recipes WHERE scope=? AND sales_code IN(SELECT json_extract(value,'$.code') FROM json_each(?)) AND ${guard}`).bind(scope,codes,scope,rid));
 }
 upsert('print_rule_links',[...printLinkFields,'updated_at'],['code'],change.printLinks.map(r=>({...r,updated_at:Math.max(now,(plan.ctx.rows[7].find(v=>v.code===r.code)?.updated_at??0)+1)})));
 return true;
}
