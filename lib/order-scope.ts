export type ImportIgnoreRule={id:string;pattern:string;mode:'exact'|'prefix';note:string;enabled:number;created_at:number;updated_at:number};
export const DEFAULT_IGNORE_RULES:ImportIgnoreRule[]=[{id:'scent-card-test',pattern:'XLXH-HM-XK',mode:'prefix',note:'香卡测试商品暂不纳入仓库',enabled:1,created_at:0,updated_at:0}];
export const ignoredOrderCode=(code:unknown,rules:ImportIgnoreRule[]=DEFAULT_IGNORE_RULES)=>typeof code==='string'&&rules.some(r=>r.enabled&&(r.mode==='exact'?code.trim()===r.pattern:code.trim().startsWith(r.pattern)));
export async function readImportIgnoreRules(d:D1Database,scope:string){return (await d.prepare('SELECT id,pattern,mode,note,enabled,created_at,updated_at FROM import_ignore_rules WHERE scope=? ORDER BY created_at DESC,id').bind(scope).all<ImportIgnoreRule>()).results;}
export const IGNORED_ORDER_REASON='命中导入忽略规则，暂不纳入仓库';
