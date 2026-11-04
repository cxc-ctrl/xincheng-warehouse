import {buildFreightAnalysis,type FreightData,type ProfitOrder} from './freight-reconciliation';
import type {OrderLine} from './model';
export type Shop={id:string;platform:string;code:string;name:string;team:string;kind:'own'|'supply';enabled:number;updated_at:number};
export type ShopPolicy={name:string;team:string;supplier_team:string;kind:'own'|'supply';rate_bps:number;goods:boolean;packing:boolean;freight:boolean};
export type ShopVersion={id:string;shop_id:string;effective_at:number;config:ShopPolicy;created_at:number};
export type ShopAssignment={platform:string;shop:string;order_id:string;version_id:string;basis_at:number};
export type ShopPending={platform:string;shop:string;orders:number;lines:number;first_at:number;reason:string};
export type ShopHeld={id:string;filename:string;updated_at:number;line:OrderLine};
export type ShopData={sourceShopMappings?:import("./order-sources").SourceShopMapping[];shopConfigs:Shop[];shopVersions:ShopVersion[];shopAssignments:ShopAssignment[];shopPending:ShopPending[];shopHeld:ShopHeld[];shopHeldTotal:number;shopHeldPage:number;supplierTeam:string};
export const EMPTY_SHOPS:ShopData={shopConfigs:[],shopVersions:[],shopAssignments:[],shopPending:[],shopHeld:[],shopHeldTotal:0,shopHeldPage:0,supplierTeam:'现货团队'};
export const shopKey=(platform:string,shop:string)=>JSON.stringify([platform||'',shop]);
export const pricingKey=(o:Pick<OrderLine,'platform'|'shop'|'order_id'>)=>JSON.stringify([o.platform||'',o.shop,o.order_id]);
export function unknownShops(lines:OrderLine[],shops:Shop[]){const known=new Set(shops.filter(s=>s.enabled).map(s=>shopKey(s.platform,s.code)));return lines.filter(o=>o.shop.trim()&&!known.has(shopKey(o.platform,o.shop)));}
export type SettlementRow={base:ProfitOrder;policy:ShopPolicy|null;version:ShopVersion|null;markup:number|null;settlement:number|null;shopProfit:number|null;supplierProfit:number|null;reason:string[]};
export function shopSettlements(orders:OrderLine[],freight:FreightData,shops:ShopData,returns:Iterable<string>=[]):SettlementRow[]{
 const versions=new Map(shops.shopVersions.map(v=>[v.id,v])),assigned=new Map(shops.shopAssignments.map(a=>[JSON.stringify([a.platform,a.shop,a.order_id]),a.version_id]));
 return buildFreightAnalysis(orders,freight,returns).rows.map(base=>{
  const ids=new Set(base.lines.map(o=>assigned.get(pricingKey(o)))),platforms=new Set(base.lines.map(o=>o.platform));
  const version=ids.size===1?versions.get([...ids][0]??'')??null:null,policy=version?.config??null,reason=[...base.reasons];
  if(!policy)reason.push('店铺待归属或缺适用结算规则');if(platforms.size>1)reason.push('同店铺编码的订单跨平台冲突');
  const valid=!!policy&&platforms.size===1&&!base.reasons.some(r=>/售后|状态|复核/.test(r));
  const components=policy?[policy.goods?base.goods:0,policy.packing?base.packing:0,policy.freight?base.freight:0]:[null];
  const markup=valid&&components.every(n=>n!=null)?Math.round(components.reduce<number>((n,x)=>n+(x??0),0)*(policy!.kind==='supply'?policy!.rate_bps:0)/10000):null;
  const complete=base.goods!=null&&base.packing!=null&&base.freight!=null&&markup!=null;
  const settlement=complete?base.goods!+base.packing!+base.freight!+markup!:null;
  const shopProfit=settlement!=null&&base.net!=null&&reason.length===0?base.net-settlement:null;
  return {base,version,policy,markup,settlement,shopProfit,supplierProfit:policy?.kind==='supply'?markup:0,reason:[...new Set(reason)]};
 });
}
export function teamProfit(row:SettlementRow,team:string){
 if(!team)return row.base.profit;
 const p=row.policy;if(!p)return null;
 if(p.team===team&&p.supplier_team===team)return row.base.profit;
 if(p.team===team)return row.shopProfit;
 if(p.kind==='supply'&&p.supplier_team===team)return row.supplierProfit;
 return 0;
}
