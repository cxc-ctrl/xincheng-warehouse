// Ordinary stock may be inferred from complete catalog metadata. Explicit
// warehouse recipes always win; balances are never part of a catalog sync.
type Obj=Record<string,any>;
const norm=(s:string)=>s.toLowerCase().replace(/厘米|cm/g,'').replace(/[×*]/g,'x').replace(/\s/g,'');
const baseName=(s:string)=>s.replace(/[-－\s]*\d+\s*(贴|枚|张|个|件)$/, '').replace(/[-－\s]+$/,'');
const baseCode=(v:Obj)=>v.sku.replace(new RegExp('[-_]'+v.pack_qty+'$'),'');
const identity=(v:Obj)=>JSON.stringify([v.product_id,v.inventory_group||baseCode(v)]);
const compatible=(a:Obj,b:Obj)=>norm(a.size||'')===norm(b.size||'')&&norm(a.material||'')===norm(b.material||'')&&a.pack_unit===b.pack_unit;
const ordinary=(v:Obj)=>v.supply_mode==='现货'&&['','待关联'].includes(v.inventory_mode||'')&&!/数字贴|数码贴|任选|自选|混选|随机|混合|混装|组合|套装/.test((v.category||'')+' '+v.name)&&!/SZT-/i.test(v.sku);

export async function prepareAutoStocks(d:D1Database,scope:string,body:Obj){
 const issues:{codes:string[];reason:string}[]=[],autoStocks=new Set<string>(),autoLinks:string[]=[];
 const ids=JSON.stringify([...new Set(body.variants.map((v:Obj)=>v.product_id).filter(Boolean))]);
 const incoming=JSON.stringify(body.variants.map((v:Obj)=>v.sku));
 const args=[scope,ids,incoming];
 const selection='scope=? AND (source_product IN(SELECT value FROM json_each(?)) OR code IN(SELECT value FROM json_each(?)))';
 const codeQuery=`SELECT code FROM product_supply_profiles WHERE ${selection} UNION SELECT value FROM json_each(?)`;
 const codeArgs=[...args,incoming];
 const checks:{query:string;args:any[];snapshot:string}[]=[];
 async function read(query:string,values:any[],columns:string[]){
  const aggregate=`SELECT json_group_array(json_object(${columns.map(c=>`'${c}',${c}`).join(',')})) AS snapshot FROM (${query})`;
  const r=await d.prepare(aggregate).bind(...values).first<{snapshot:string}>();
  const snapshot=r?.snapshot||'[]';checks.push({query:aggregate,args:values,snapshot});return JSON.parse(snapshot) as Obj[];
 }
 const profiles=await read(`SELECT code,source_product,config FROM product_supply_profiles WHERE ${selection} ORDER BY code`,args,['code','source_product','config']);
 const products=await read(`SELECT code,stock_mode,quantity,count_at,tracking_enabled FROM products WHERE scope=? AND code IN(${codeQuery}) ORDER BY code`,[scope,...codeArgs],['code','stock_mode','quantity','count_at','tracking_enabled']);
 const rules=await read(`SELECT sales_code,stock_code,per_unit FROM stock_rules WHERE scope=? AND sales_code IN(${codeQuery}) ORDER BY sales_code,stock_code`,[scope,...codeArgs],['sales_code','stock_code','per_unit']);
 const candidates=body.variants.filter((v:Obj)=>ordinary(v)&&v.product_id&&!body.warehouse_config.links.some((l:Obj)=>l.sku===v.sku));
 const stockCodes=new Map<string,string>();
 for(const v of candidates){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity(v)));stockCodes.set(identity(v),'PC-'+Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,24)+'-STOCK');}
 const codes=JSON.stringify([...stockCodes.values(),...rules.map(r=>r.stock_code)]);
 const stocks=await read('SELECT code,name,spec,unit,cost,archived FROM physical_stocks WHERE scope=? AND code IN(SELECT value FROM json_each(?)) ORDER BY code',[scope,codes],['code','name','spec','unit','cost','archived']);
 const catalog=new Map(profiles.map(p=>[p.code,JSON.parse(p.config).variant]));
 for(const v of body.variants)catalog.set(v.sku,v);
 for(const key of new Set<string>(candidates.map((v:Obj)=>identity(v)))){
  const members=candidates.filter((v:Obj)=>identity(v)===key);
  const unlinked=members.filter((v:Obj)=>!rules.some(r=>r.sales_code===v.sku));
  if(!unlinked.length)continue;
  const first=members[0];let reason='';
  const all=[...catalog.values()].filter(v=>v.supply_mode==='现货'&&(identity(v)===key||(!v.inventory_group||!first.inventory_group)&&v.product_id===first.product_id&&baseCode(v)===baseCode(first)));
  if(all.some(v=>!v.size||!v.material))reason='尺寸或材质未填写';
  else if(all.some(v=>!compatible(v,first)))reason='同款尺寸、材质或库存单位不一致';
  else if(!first.inventory_group&&all.some(v=>baseName(v.name)!==baseName(first.name)))reason='同编码前缀的款式名称不一致';
  else if(all.some(v=>/任选|自选|混选|随机|混合|混装|组合|套装|数字贴/.test(v.name)))reason='组合款或数字贴需使用专用库存规则';
  else if(all.some(v=>body.warehouse_config.links.some((l:Obj)=>l.sku===v.sku)))reason='同款已有前端指定关联，请核对新增包装';
  else if(unlinked.some((v:Obj)=>{const p=products.find(p=>p.code===v.sku);return p&&(p.stock_mode==='direct'||p.quantity!=null||p.count_at!=null||p.tracking_enabled===0);}))reason='已有独立库存或停用设置，保留仓库记录';
  const related=rules.filter(r=>all.some(v=>v.sku===r.sales_code));
  const targets=[...new Set(related.map(r=>r.stock_code))];
  if(!reason&&(targets.length>1||related.some(r=>r.per_unit!==catalog.get(r.sales_code)?.pack_qty)))reason='同款已有特殊关联，请人工核对新增包装';
  const code=targets[0]||stockCodes.get(key)!;
  const existing=stocks.find(s=>s.code===code);
  if(!reason&&existing&&(existing.archived||existing.unit!==first.pack_unit||norm(existing.spec||'')!==norm(first.size)))reason='已有实物单位、尺寸或归档状态冲突';
  if(!reason&&targets.length&&!existing)reason='关联实物不存在';
  if(!reason&&existing&&!targets.length)reason='已有同编码实物但缺少关联，请人工核对';
  if(reason){issues.push({codes:unlinked.map((v:Obj)=>v.sku),reason});continue;}
  // Prefer the largest pack to minimize cent-rounding error. Inconsistent
  // package prices do not become a guessed physical unit cost.
  const priced=all.filter(v=>v.cost!=null).sort((a,b)=>b.pack_qty-a.pack_qty);
  let cost=priced.length?Number((priced[0].cost/priced[0].pack_qty).toFixed(8)):null;
  if(cost!=null&&priced.some(v=>Math.abs(cost!*v.pack_qty-v.cost)>0.010001))cost=null;
  if(!existing){
   body.warehouse_config.stocks.push({code,name:baseName(first.name),size:first.size,unit:first.pack_unit,kind:'普通实物',cost,note:'产品中心同步自动建档；实际数量由仓库盘点。'});
   autoStocks.add(code);
  }
  for(const v of unlinked){body.warehouse_config.links.push({sku:v.sku,stock_code:code,mode:'固定数量',quantity:v.pack_qty});autoLinks.push(v.sku);}
 }
 return {checks,issues,autoStocks:[...autoStocks],autoLinks};
}

export function guardAutoStocks(d:D1Database,ss:D1PreparedStatement[],checks:{query:string;args:any[];snapshot:string}[],scope:string,rid:string,guard:string){
 for(const c of checks)ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND (${c.query})<>? THEN json('同款库存关联已变化，请重新预览同步') ELSE 1 END`).bind(scope,rid,...c.args,c.snapshot));
}
