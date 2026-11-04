import {emptyWeight,weightKey,validateProfile,type CostSettings,type WeightProfile} from './fulfillment';
import type {InventoryRow} from './model';

export type StockCostDraft={profile:WeightProfile;unit_cost:string;original_cost:number|null;dimension_source?:string};
type Dimensions=Pick<WeightProfile,'shape'|'length_cm'|'width_cm'>;
const cm=(n:string,unit:string)=>Number(n)*(unit==='mm'||unit==='毫米'?.1:unit==='m'||unit==='米'?100:1);
const valid=(n:number)=>Number.isFinite(n)&&n>=.001&&n<=10000;

export function stockDimensions(spec:string,unit:string):Dimensions|null{
 if(['份','包','卷','套'].includes(unit))return null;
 const text=spec.normalize('NFKC').toLowerCase().replace(/[×✕＊]/g,'x'),found:Dimensions[]=[];
 const pairs=/(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?\s*[x*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?/g;
 for(const m of text.matchAll(pairs)){
  const before=text.slice(0,m.index),after=text.slice(m.index!+m[0].length);
  if(/[\d.\-x*]\s*$/.test(before)||/^\s*[x*]/.test(after)||/^[a-z]/.test(after)||/^\s*(贴|枚|张|份|包|件|个)/.test(after))continue;
  const length=cm(m[1],m[2]||m[4]||'cm'),width=cm(m[3],m[4]||m[2]||'cm');
  if(valid(length)&&valid(width))found.push({shape:'rectangle',length_cm:length,width_cm:width});
 }
 const unique=[...new Map(found.map(d=>[JSON.stringify(d),d])).values()];
 if(unique.length)return unique.length===1?unique[0]:null;
 // A numeric sticker's diameter describes the individual label, not its whole paper sheet.
 if(unit==='张')return null;
 const diameters=[...new Set([...text.matchAll(/(?:直径|[φø])\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?/g)].map(m=>cm(m[1],m[2]||'cm')))];
 if(diameters.length===1&&valid(diameters[0]))return {shape:'circle',length_cm:diameters[0],width_cm:null};
 return null;
}

export function defaultCostChoices(settings:CostSettings){return {
 material_id:(settings.materials.find(m=>m.name.trim()==='铜版纸不干胶')??settings.materials.find(m=>m.id==='adhesive-80'))?.id??'',
 template_id:(settings.freightTemplates.find(t=>t.name.trim()==='圆通')??settings.freightTemplates.find(t=>t.id==='yto'))?.id??'',
};}

export function stockCostDraft(row:Pick<InventoryRow,'kind'|'code'|'unit'|'cost'> & Partial<Pick<InventoryRow,'spec'>>,settings:CostSettings):StockCostDraft{
 const saved=settings.weightProfiles.find(p=>weightKey(p)===weightKey(row)),defaults=defaultCostChoices(settings);
 const profile=saved?.unit===row.unit?{...saved}:{...emptyWeight(row.kind,row.code,row.unit),updated_at:saved?.updated_at??0,material_id:saved?.material_id??'',template_id:saved?.template_id??''};
 profile.material_id ||= defaults.material_id;profile.template_id ||= defaults.template_id;
 const dimensions=stockDimensions(row.spec??'',row.unit);let inferred=false;
 if(dimensions){
  if(profile.length_cm==null&&profile.width_cm==null){Object.assign(profile,dimensions);inferred=true;}
  else if(profile.shape===dimensions.shape){
   if(profile.length_cm==null){profile.length_cm=dimensions.length_cm;inferred=true;}
   if(profile.shape==='rectangle'&&profile.width_cm==null){profile.width_cm=dimensions.width_cm;inferred=true;}
  }
 }
 return {profile,unit_cost:row.cost==null?'':String(row.cost),original_cost:row.cost,...(inferred?{dimension_source:row.spec}:{} )};
}

export function inventoryCostPayload(d:Pick<StockCostDraft,'unit_cost'|'original_cost'>){const n=d.unit_cost===''?null:Number(d.unit_cost);if(n!=null&&(!Number.isFinite(n)||n<0||n>1e8))throw new Error('请填写有效的单位货品成本');return {unit_cost:n,expected_unit_cost:d.original_cost};}

export function costPayload(d:StockCostDraft){return {...inventoryCostPayload(d),weight_profile:validateProfile(d.profile)};}
