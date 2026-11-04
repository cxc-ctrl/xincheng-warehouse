import type {Product,PhysicalStock,StockRule,InventoryRow} from './model';

export type Material={id:string;name:string;gsm:number;weight_kg_m2?:number|null;updated_at:number};
export type FreightRate={name:string;provinces:string[];cities:string[];prices:[number,number,number,number];extra_kg:number;surcharge:number};
export type FreightTemplate={id:string;name:string;packing_fee:number|null;packing_weight_g:number|null;divisor:number;extra_confirmed:boolean;rates:FreightRate[];note:string;updated_at:number};
export type WeightProfile={kind:'physical'|'product';code:string;unit:string;material_id:string;shape:'rectangle'|'circle';length_cm:number|null;width_cm:number|null;measured_g:number|null;template_id:string;updated_at:number};
export type CostSettings={materials:Material[];freightTemplates:FreightTemplate[];weightProfiles:WeightProfile[]};
export const DEFAULT_MATERIALS:Material[]=[{id:'adhesive-80',name:'不干胶（暂定）',gsm:80,updated_at:0},{id:'card-300',name:'卡片',gsm:300,updated_at:0}];
const rate=(name:string,provinces:string[],prices:FreightRate['prices'],extra_kg:number,cities:string[]=[],surcharge=0):FreightRate=>({name,provinces,cities,prices,extra_kg,surcharge});
export const FREIGHT_OVER_3_RULE='超过3kg：1kg档价 +（含包装实际重量 - 1kg）× 续重单价。续重按小数公斤计算，最终金额保留两位小数。';
export const DEFAULT_FREIGHT:FreightTemplate={id:'yto',name:'圆通',packing_fee:null,packing_weight_g:null,divisor:6000,extra_confirmed:true,updated_at:0,
 rates:[
  rate('一区',['浙江','江苏','安徽'],[2.3,3,3.85,4.7],.85),
  rate('上海',['上海'],[2.3,3.5,4.35,5.2],.85,[],1),
  rate('二区',['福建','江西','广东','天津','山东','河南','河北','湖北','湖南'],[2.3,3,3.85,4.7],1.15),
  rate('三区',['广西','贵州','四川','重庆','陕西','山西','云南','辽宁','吉林','黑龙江'],[2.3,3,3.85,4.7],1.75),
  rate('北京',['北京'],[2.3,3,3.85,4.7],1.75,[],1),
  rate('四区',['海南','甘肃','宁夏','青海','内蒙古'],[3.7,4,5.05,6.1],3.55),
  rate('五区',['新疆','西藏'],[15.2,15.2,30.25,45.3],15.05),
  rate('特区',['澳门','台湾','香港'],[25,25,50,75],25),
  rate('四川特殊区域',['四川'],[5.2,5.2,10.25,15.3],5.05,['阿坝','甘孜','凉山']),
 ],note:'来源：用户提供的圆通价格表。北京、上海每票加1元（以总部通知为准）。预付2.5元/单（含义待核对，未计入）。按含包装实际重量计费。'+FREIGHT_OVER_3_RULE};
export const weightKey=(p:Pick<WeightProfile,'kind'|'code'>)=>p.kind+':'+p.code;
export const roundMoney=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
// The editable shipping-weight factor is independent of a material's nominal paper grade.
// Legacy records retain their previous calculation until a factor is configured.
export const materialWeightFactor=(m:Material)=>m.weight_kg_m2??m.gsm/1000;
export function unitWeight(p:WeightProfile|undefined,materials:Material[],unit:string):number|null {
 if(!p||p.unit!==unit)return null;
 if(p.measured_g!=null)return p.measured_g>0?p.measured_g:null;
 const material=materials.find(m=>m.id===p.material_id),factor=material?materialWeightFactor(material):null;
 if(!factor||!p.length_cm||p.shape==='rectangle'&&!p.width_cm)return null;
 const area=p.shape==='circle'?Math.PI*(p.length_cm/2)**2:p.length_cm*p.width_cm!;
 return area/10000*factor*1000;
}
export function emptyWeight(kind:WeightProfile['kind'],code:string,unit:string):WeightProfile{return {kind,code,unit,material_id:'',shape:'rectangle',length_cm:null,width_cm:null,measured_g:null,template_id:'',updated_at:0};}
export function skuFulfillment(p:Product,stocks:PhysicalStock[],rules:StockRule[],settings:CostSettings){
 const profiles=new Map(settings.weightProfiles.map(w=>[weightKey(w),w]));
 const parts=p.stock_mode==='recipe'?rules.filter(r=>r.sales_code===p.code).map(r=>({stock:stocks.find(s=>s.code===r.stock_code&&!s.archived),amount:r.per_unit,kind:'physical' as const})): [{stock:p,amount:1,kind:'product' as const}];
 const missing:string[]=[],templates=new Set<string>();let grams=0,goods=0,costKnown=parts.length>0;
 if(!parts.length)missing.push('未关联实际发货实物');
 for(const part of parts){if(!part.stock){missing.push('关联实物已移除');costKnown=false;continue;}
  const w=profiles.get(part.kind+':'+part.stock.code),g=unitWeight(w,settings.materials,part.stock.unit??'张');
  if(g==null)missing.push(part.stock.code+' 缺重量参数');else grams+=g*part.amount;
  if(part.stock.cost==null)costKnown=false;else goods+=part.stock.cost*part.amount;
  if(w?.template_id)templates.add(w.template_id);
 }
 return {grams:missing.length?null:grams,goodsCost:costKnown?goods:p.cost,goodsSource:costKnown&&p.stock_mode==='recipe'?'实物成本换算':'SKU录入成本',missing,templateIds:[...templates]};
}
export function inventoryValuation(rows:InventoryRow[],settings:CostSettings){let value=0,grams=0,missingCost=0,missingWeight=0,uncounted=0;const profiles=new Map(settings.weightProfiles.map(p=>[weightKey(p),p]));
 for(const row of rows){if(row.quantity==null){uncounted++;continue;}if(row.cost==null)missingCost++;else value+=row.quantity*row.cost;
 const g=unitWeight(profiles.get(weightKey(row)),settings.materials,row.unit);if(g==null)missingWeight++;else grams+=row.quantity*g;}
 return {value,grams,missingCost,missingWeight,uncounted};
}
export function provinceName(v:string){return v.trim().replace(/(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/,'');}
export function freightQuote(t:FreightTemplate,province:string,city:string,goodsGrams:number|null,_legacyDimensions?:number[]){
 const errors:string[]=[],notes:string[]=[];const p=provinceName(province);
 const possible=t.rates.filter(r=>r.provinces.some(v=>provinceName(v)===p));
 const special=possible.filter(r=>r.cities.length),matches=special.filter(r=>r.cities.some(c=>city.trim().startsWith(c)));
 if(special.length&&!city.trim())errors.push('该省有特殊运价，请填写收件城市/州');
 const matched=matches.length?matches:possible.filter(r=>!r.cities.length);
 if(matched.length!==1)errors.push(matched.length?'地区重复匹配，请修正模板':'未找到该地区价格');
 if(goodsGrams==null||!Number.isFinite(goodsGrams)||goodsGrams<=0)errors.push('货品重量待补充');
 if(t.packing_weight_g==null)errors.push('请设置包装重量（不计则填0）');
 // Legacy parcel dimensions and divisor are retained in stored data only; billing uses actual weight.
 const volumeKg=null;
 const actualKg=goodsGrams==null||t.packing_weight_g==null?null:(goodsGrams+t.packing_weight_g)/1000;
 const billedKg=actualKg;let shipping:number|null=null;
 if(!errors.length&&matched[0]&&billedKg!=null){const r=matched[0],tier=[.5,1,2,3].findIndex(limit=>billedKg<=limit+1e-9);
  const charge=(tier>=0?r.prices[tier]:r.prices[1]+(billedKg-1)*r.extra_kg)+r.surcharge;
  // Round only the final charge; account for binary floating point at a half-cent boundary.
  shipping=roundMoney(charge+Math.abs(charge)*Number.EPSILON);
 }
 return {shipping,packing:t.packing_fee,actualKg,volumeKg,billedKg,rate:matched[0],errors,notes};
}
const finite=(v:unknown,name:string,min=0,max=1e8):number=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(name+'格式不正确');return v;};
const nullable=(v:unknown,name:string,min=0,max=1e8)=>v==null?null:finite(v,name,min,max);
const txt=(v:unknown,name:string,max=160)=>{if(typeof v!=='string'||v.trim().length>max||/[\r\n]/.test(v))throw new Error(name+'格式不正确');return v.trim();};
const version=(v:unknown)=>{if(!Number.isSafeInteger(v))throw new Error('版本格式不正确');return finite(v,'版本',0,4102444800000);};
export function validateMaterial(v:Material):Material {const m={id:txt(v.id,'材质编号'),name:txt(v.name,'材质名称'),gsm:finite(v.gsm,'材质标称克重',.01,10000),...(v.weight_kg_m2===undefined?{}:{weight_kg_m2:finite(v.weight_kg_m2,'重量系数',.00001,10)}),updated_at:version(v.updated_at)};if(!m.id||!m.name)throw new Error('请填写材质名称');return m;}
export function validateProfile(v:WeightProfile):WeightProfile {if(!['physical','product'].includes(v.kind)||!['rectangle','circle'].includes(v.shape))throw new Error('重量参数类型不正确');return {kind:v.kind,code:txt(v.code,'实物编码'),unit:txt(v.unit,'库存单位',10),material_id:txt(v.material_id,'材质编号'),shape:v.shape,length_cm:nullable(v.length_cm,'长度/直径',.001,10000),width_cm:nullable(v.width_cm,'宽度',.001,10000),measured_g:nullable(v.measured_g,'单位实称重量',.000001),template_id:txt(v.template_id,'快递模板'),updated_at:version(v.updated_at)};}
export function validateTemplate(v:FreightTemplate):FreightTemplate {
 const id=txt(v.id,'模板编号'),name=txt(v.name,'模板名称');if(!id||!name||!Array.isArray(v.rates)||!v.rates.length||v.rates.length>100)throw new Error('请填写模板名称和地区价格');
 const seen=new Set<string>();const rates=v.rates.map(r=>{const list=(a:unknown,label:string)=>{if(!Array.isArray(a)||a.length>50)throw new Error(label+'格式不正确');return a.map(x=>txt(x,label,40)).filter(Boolean);};const provinces=list(r.provinces,'省份'),cities=list(r.cities,'城市');if(!provinces.length||!Array.isArray(r.prices)||r.prices.length!==4)throw new Error('地区及四个重量档位必须填写');
 for(const p of provinces)for(const c of cities.length?cities:['*']){const key=provinceName(p)+':'+c;if(seen.has(key))throw new Error('地区重复：'+key);seen.add(key);}
 const prices=r.prices.map(n=>finite(n,'快递价格')) as FreightRate['prices'];if(prices.some((n,i)=>i>0&&n<prices[i-1]))throw new Error('重量越高的价格不能低于上一档');
 return {name:txt(r.name,'地区名称'),provinces,cities,prices,extra_kg:finite(r.extra_kg,'续重价格'),surcharge:finite(r.surcharge,'每票附加费')};});
 return {id,name,rates,packing_fee:nullable(v.packing_fee,'打包费'),packing_weight_g:nullable(v.packing_weight_g,'包装重量'),divisor:finite(v.divisor,'体积重除数',1,100000),extra_confirmed:true,note:typeof v.note==='string'?v.note.slice(0,2000):'',updated_at:version(v.updated_at)};
}
