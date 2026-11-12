import type {Product} from './model';
import {transparentDigitRange} from './transparent-digit-range';
import {readDigitConditions} from './warehouse-digit-conditions';
export async function supplyProducts(d:D1Database,scope:string,products:Product[]):Promise<Product[]>{
 if(!products.length)return products;
 const conditions=await readDigitConditions(d,scope);
 const rows=(await d.prepare(`SELECT p.code,p.source_product,p.source_revision,p.updated_at AS synced_at,json_extract(p.config,'$.variant.product_name') AS product_name,json_extract(p.config,'$.variant.images') AS images,json_extract(p.config,'$.variant.price') AS price,json_extract(p.config,'$.variant.supply_mode') AS supply_mode,json_extract(p.config,'$.variant.cost_mode') AS cost_mode,EXISTS(SELECT 1 FROM json_each(p.config,'$.links') l WHERE json_extract(l.value,'$.sku')=p.code AND json_extract(l.value,'$.mode')='按数字范围') AS dynamic_cost FROM product_supply_profiles p WHERE p.scope=? AND p.code IN(SELECT value FROM json_each(?))`).bind(scope,JSON.stringify(products.map(p=>p.code))).all<{code:string;source_product:string;source_revision:number;synced_at:number;product_name:string|null;images:string|null;price:number|null;supply_mode:string;cost_mode:string|null;dynamic_cost:number}>()).results;
 const byCode=new Map(rows.map(r=>[r.code,r]));return products.map(p=>{const r=byCode.get(p.code),boundary=transparentDigitRange(p.name,conditions);return r?{...p,source_product:r.source_product,source_revision:r.source_revision,synced_at:r.synced_at,product_name:r.product_name||'',images:r.images?JSON.parse(r.images):[],price:r.price,supply_mode:boundary?.outside&&boundary.condition.out_of_range==='建议整单打印'?'打印定制':r.supply_mode,...(r.cost_mode?{cost_mode:r.cost_mode}:{}),dynamic_cost:!!r.dynamic_cost}:p;});
}

