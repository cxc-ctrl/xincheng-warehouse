import {DEFAULT_MATERIALS,DEFAULT_FREIGHT,validateMaterial,validateProfile,validateTemplate,type Material,type WeightProfile,type FreightTemplate,type CostSettings} from './fulfillment';

export async function readCostSettings(d:D1Database,scope:string):Promise<CostSettings>{
 const result=await d.batch([d.prepare('SELECT id,name,gsm,weight_kg_m2,updated_at FROM cost_materials WHERE scope=? ORDER BY name').bind(scope),d.prepare('SELECT payload,updated_at FROM freight_templates WHERE scope=? ORDER BY id').bind(scope),d.prepare('SELECT payload,updated_at FROM inventory_weights WHERE scope=?').bind(scope)]);
 const materials=result[0].results as Material[],templates=result[1].results as {payload:string;updated_at:number}[],weights=result[2].results as {payload:string;updated_at:number}[];
 return {materials:[...DEFAULT_MATERIALS.filter(m=>!materials.some(s=>s.id===m.id)),...materials],freightTemplates:[...(!templates.some(t=>JSON.parse(t.payload).id===DEFAULT_FREIGHT.id)?[DEFAULT_FREIGHT]:[]),...templates.map(t=>({...JSON.parse(t.payload),updated_at:t.updated_at}) as FreightTemplate)],weightProfiles:weights.map(t=>({...JSON.parse(t.payload),updated_at:t.updated_at}) as WeightProfile)};
}
export async function appendWeight(d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,raw:WeightProfile,settings?:CostSettings){
 const p=validateProfile(raw),s=settings??await readCostSettings(d,scope),table=p.kind==='physical'?'physical_stocks':'products';
 const stock=await d.prepare(`SELECT unit FROM ${table} WHERE scope=? AND code=? ${p.kind==='physical'?'AND archived=0':"AND stock_mode='direct'"}`).bind(scope,p.code).first<{unit:string}>();
 if(!stock||stock.unit!==p.unit)throw new Error('实物或库存单位已变化，请刷新后重新填写：'+p.code);
 if(p.material_id&&!s.materials.some(m=>m.id===p.material_id))throw new Error('材质不存在');
 if(p.template_id&&!s.freightTemplates.some(t=>t.id===p.template_id))throw new Error('快递模板不存在');
 const old=s.weightProfiles.find(w=>w.code===p.code&&w.kind===p.kind);if((old?.updated_at??0)!==p.updated_at)throw new Error('重量参数已被修改，请刷新后重试：'+p.code);
 statements.push(d.prepare(`SELECT CASE WHEN ${guard} AND (COALESCE((SELECT updated_at FROM inventory_weights WHERE scope=? AND kind=? AND code=?),0)<>? OR NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND unit=?)) THEN json('重量参数已变化') ELSE 1 END`).bind(scope,rid,scope,p.kind,p.code,p.updated_at,scope,p.code,p.unit));
 statements.push(d.prepare(`INSERT INTO inventory_weights(scope,kind,code,payload,updated_at) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,kind,code) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(scope,p.kind,p.code,JSON.stringify({...p,updated_at:now}),now,scope,rid));
}
export async function appendCountCost(d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string,kind:'physical'|'product',item:{code:string;unit_cost?:unknown;expected_unit_cost?:unknown;weight_profile?:WeightProfile}){
 if(Object.hasOwn(item,'unit_cost')){const value=item.unit_cost;if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e8))throw new Error('货品单位成本不正确');const table=kind==='physical'?'physical_stocks':'products';
  if(Object.hasOwn(item,'expected_unit_cost')){const old=item.expected_unit_cost;if(old!==null&&(typeof old!=='number'||!Number.isFinite(old)||old<0||old>1e8))throw new Error('原成本格式不正确');statements.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND code=? AND cost IS ?) THEN json('货品成本已变化') ELSE 1 END`).bind(scope,rid,scope,item.code,old as number|null));}
  statements.push(d.prepare(`UPDATE ${table} SET cost=?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(value as number|null,now,scope,item.code,scope,rid));}
 if(item.weight_profile){if(item.weight_profile.kind!==kind||item.weight_profile.code!==item.code)throw new Error('重量资料与盘点实物不一致');await appendWeight(d,scope,now,rid,statements,guard,item.weight_profile);}
}
export async function appendCostAction(b:Record<string,any>,d:D1Database,scope:string,now:number,rid:string,statements:D1PreparedStatement[],guard:string){
 if(b.action==='material_save'||b.action==='freight_save'){
  const isMaterial=b.action==='material_save',value=isMaterial?validateMaterial(b.material):validateTemplate(b.template),table=isMaterial?'cost_materials':'freight_templates';
  const old=await d.prepare(`SELECT updated_at${isMaterial?',weight_kg_m2':''} FROM ${table} WHERE scope=? AND id=?`).bind(scope,value.id).first<{updated_at:number;weight_kg_m2?:number|null}>();if((old?.updated_at??0)!==value.updated_at)throw new Error('配置已被其他人修改，请刷新后重试');
  statements.push(d.prepare(`SELECT CASE WHEN ${guard} AND COALESCE((SELECT updated_at FROM ${table} WHERE scope=? AND id=?),0)<>? THEN json('配置已变化') ELSE 1 END`).bind(scope,rid,scope,value.id,value.updated_at));
  if(isMaterial){const m=value as Material;statements.push(d.prepare(`INSERT INTO cost_materials(scope,id,name,gsm,weight_kg_m2,updated_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO UPDATE SET name=excluded.name,gsm=excluded.gsm,weight_kg_m2=excluded.weight_kg_m2,updated_at=excluded.updated_at`).bind(scope,m.id,m.name,m.gsm,m.weight_kg_m2??old?.weight_kg_m2??null,now,scope,rid));}
  else statements.push(d.prepare(`INSERT INTO freight_templates(scope,id,payload,updated_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(scope,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(scope,value.id,JSON.stringify({...value,updated_at:now}),now,scope,rid));return true;
 }
 if(b.action==='weight_save'){
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>10)throw new Error('每次最多保存10条重量资料');const s=await readCostSettings(d,scope);const keys=new Set<string>();
  for(const p of b.items){const key=p.kind+':'+p.code;if(keys.has(key))throw new Error('重复的实物');keys.add(key);await appendWeight(d,scope,now,rid,statements,guard,p,s);}return true;
 }return false;
}
