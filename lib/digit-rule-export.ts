import {mergeRemarkRules,type RemarkRuleRow} from './digit-remark-actions';
import {mergeDigitConditions,type DigitCondition} from './warehouse-digit-conditions';
import {REMARK_STANDARDS,REMARK_STANDARDS_VERSION} from './digit-remark-standards';
import {REMARK_ACTIONS,REMARK_SOURCES} from './digit-remark-rules';
import type {DigitVariant} from './digit-colors';
import type {NamedPrintRule,PrintRuleLink} from './printing';
import type {StockRule} from './model';

// A scoped, single-transaction snapshot. Exporting must not import orders,
// create operation receipts, or include real stock balances / customer notes.
export async function readDigitRuleExport(d:D1Database,scope:string,now=Date.now()){
 const digitLink="EXISTS(SELECT 1 FROM digit_stock_variants v WHERE v.scope=r.scope AND (v.base_code=r.stock_code OR v.stock_code=r.stock_code))";
 const result=await d.batch([
  d.prepare('SELECT id,payload,updated_at FROM digit_remark_rules WHERE scope=? ORDER BY id').bind(scope),
  d.prepare('SELECT color,size,start,end,out_of_range,shortage,print_rule_id,enabled,updated_at FROM warehouse_digit_conditions WHERE scope=? ORDER BY size,color').bind(scope),
  d.prepare('SELECT base_code,color,stock_code,size,start,end,available_end FROM digit_stock_variants WHERE scope=? ORDER BY size,base_code,color').bind(scope),
  d.prepare(`SELECT r.sales_code,r.stock_code,r.per_unit FROM stock_rules r WHERE r.scope=? AND ${digitLink} ORDER BY r.sales_code,r.stock_code`).bind(scope),
  d.prepare(`SELECT p.code,p.name,p.spec,p.pack,p.unit,p.size,p.material,p.erp_code FROM products p WHERE p.scope=? AND EXISTS(SELECT 1 FROM stock_rules r WHERE r.scope=p.scope AND r.sales_code=p.code AND ${digitLink}) ORDER BY p.code`).bind(scope),
  d.prepare('SELECT s.code,s.name,s.unit,s.spec FROM physical_stocks s WHERE s.scope=? AND EXISTS(SELECT 1 FROM digit_stock_variants v WHERE v.scope=s.scope AND (v.base_code=s.code OR v.stock_code=s.code)) ORDER BY s.code').bind(scope),
  d.prepare('SELECT id,name,material,per_sheet,sheet_weight_g,print_cost,laminated,lamination_cost,cutting,flat_cut_cost,die_cut_cost,enabled,note,updated_at FROM print_rules WHERE scope=? ORDER BY id').bind(scope),
  d.prepare(`SELECT l.code,l.rule_id,l.per_pack_override,l.updated_at FROM print_rule_links l WHERE l.scope=? AND EXISTS(SELECT 1 FROM stock_rules r WHERE r.scope=l.scope AND r.sales_code=l.code AND ${digitLink}) ORDER BY l.code`).bind(scope),
 ]);
 const storedRemarks=result[0].results as RemarkRuleRow[],storedConditions=result[1].results as DigitCondition[],variants=result[2].results as DigitVariant[],links=result[3].results as StockRule[];
 const defaults=new Map<string,Pick<DigitCondition,'color'|'size'|'start'|'end'>>();
 for(const v of variants){const key=JSON.stringify([v.color,v.size]),old=defaults.get(key);defaults.set(key,{color:v.color,size:v.size,start:Math.min(v.start,old?.start??v.start),end:Math.min(v.available_end,old?.end??v.available_end)});}
 const keywords=mergeRemarkRules(storedRemarks),conditions=mergeDigitConditions(storedConditions,[...defaults.values()]),printLinks=result[7].results as PrintRuleLink[];
 const printIds=new Set([...conditions.map(c=>c.print_rule_id),...printLinks.map(l=>l.rule_id)].filter(Boolean));
 const printRules=(result[6].results as NamedPrintRule[]).filter(r=>printIds.has(r.id));
 const keywordRules=keywords.map(r=>({...r,source_label:REMARK_SOURCES[r.source],action_label:REMARK_ACTIONS[r.action],configuration_origin:storedRemarks.some(row=>row.id===r.id)?'已保存配置':'内置默认'}));
 return {
  format:'warehouse-digit-rules',schema_version:1,exported_at:new Date(now).toISOString(),timezone:'Asia/Shanghai',
  module:'数字贴规则',engine:{id:'digit-remark-parser',standards_version:REMARK_STANDARDS_VERSION,requires_compatible_engine:true},
  summary:{base_standards:REMARK_STANDARDS.length,keyword_rules:keywords.length,stock_conditions:conditions.length,digit_variants:variants.length,sales_stock_links:links.length,referenced_print_rules:printRules.length},
  notes:['包含全部规则，不受页面搜索、分类或启停筛选影响。','关键词和备货条件为导出时的当前数据库配置。内置标准随本文件留存，固定判断需要兼容版本的系统执行。','保存此文件，后续可交给助手核对并继续补充规则。可通过“导入规则”预览差异后恢复配置。','不含实际库存数量、订单、买卖家真实备注、人工处理结果或历史扣减流水；不能替代完整数据库备份。','关联产品和实物仅作编码参照；清空商品后恢复关联前，需要先重新导入相同SKU及实物编码。'],
  base_standards:REMARK_STANDARDS.map(r=>{const keyword=keywords.find(k=>k.id===r.editRuleId);return {...r,...(keyword?{when:keyword.enabled?keyword.keywords.join('、'):'当前已停用',result:keyword.enabled?REMARK_ACTIONS[keyword.action]+(keyword.action==='color'?'：'+keyword.color:''):'本条关键词规则已停用'}:{})};}),
  keyword_rules:keywordRules,
  stock_conditions:conditions.map(c=>({...c,configuration_origin:storedConditions.some(s=>s.color===c.color&&s.size===c.size)?'已保存配置':'沿用版面范围'})),
  digit_variants:variants,sales_stock_links:links,sales_product_references:result[4].results,physical_stock_references:result[5].results,
  referenced_print_rules:printRules,referenced_print_links:printLinks,
  missing_print_rule_ids:[...printIds].filter(id=>!printRules.some(r=>r.id===id)),
 };
}
export type DigitRuleExport=Awaited<ReturnType<typeof readDigitRuleExport>>;
