import {chinaTime,isValid,type OrderLine} from './model';
import {splitWaybills} from './freight-reconciliation';
export type SourceDetails={kind:'xiaohongshu';shop_name:string;status:string;after_sale:string;sku_ids:string[];line_amount:number;buyer_amount:number;shipment_confirmed?:boolean};
export type SourceShopMapping={source:string;source_shop:string;platform:string;shop:string};
export function sourceDetails(o:Pick<OrderLine,'source_details'>):SourceDetails|null{try{const v=JSON.parse(o.source_details||'null');return v?.kind==='xiaohongshu'?v:null;}catch{return null;}}
export function sourceNeedsReview(o:OrderLine){const s=sourceDetails(o);return !!s&&!(o.status==='已取消'&&!o.shipped_at)&&((!!s.after_sale&&s.after_sale!=='无售后')||(!isValid(o.status)&&!!o.shipped_at));}
export function sourceReviewText(o:OrderLine){const s=sourceDetails(o);if(!s)return '';const detail=!isValid(o.status)&&o.shipped_at&&!s.shipment_confirmed?'有发货记录，需确认实际出库；尚未自动扣库存。':s.after_sale&&s.after_sale!=='无售后'?'退款金额未提供，请核对售后结果；不会自动回补库存。':'沿用商品关联及盘点时间计算库存和成本。';return `小红书原状态：${s.status}；售后：${s.after_sale||'未提供'}。${detail}`;}
export function normalizeXhsStatus(status:string){
 const map:Record<string,string>={'已发货未签收':'已发货','已签收':'已完成','已完成':'已完成','已发货':'已发货','待发货':'待发货','待付款':'待付款','待支付':'待付款','已取消':'已取消','已关闭':'已关闭'};
 if(!map[status])throw Error('暂不支持的小红书订单状态：'+status+'，请先核对');return map[status];
}
export function xhsLine(v:(label:string)=>string):OrderLine{
 const required=(label:string)=>{const s=v(label).trim();if(!s)throw Error('缺少'+label);return s;};
 const quantity=Number(required('SKU件数'));if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>10000000)throw Error('SKU件数必须是正整数');
 const money=(label:string)=>{const raw=required(label),n=Number(raw);if(!Number.isFinite(n)||n<0||n>1e8)throw Error(label+'金额无效');return Math.round(n*100)/100;};
 const date=(label:string)=>v(label)?chinaTime(v(label)):null;
 const shopName=required('店铺名称'),shop='XHS:'+shopName,order_id=required('订单号'),code=v('商家编码').trim(),title=v('商品名称')||v('SKU名称'),spec=v('SKU规格'),rawStatus=required('订单状态'),status=normalizeXhsStatus(rawStatus);
 if(/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(order_id)||!/^[A-Za-z0-9_-]+$/.test(order_id))throw Error('订单号须为完整文本（保留字母前缀），不能使用科学计数法');
 const detail:SourceDetails={kind:'xiaohongshu',shop_name:shopName,status:rawStatus,after_sale:v('售后状态'),sku_ids:[required('规格ID')],line_amount:money('商家应收金额(元)（支付金额）'),buyer_amount:money('用户应付金额(元)')};
 const shipped_at=date('订单发货时间');if(isValid(status)&&!shipped_at)throw Error('已发货订单缺少订单发货时间');
 return {key:JSON.stringify([shop,order_id,code||'未填编码:'+title+':'+spec]),order_id,shop,platform:'XHS',code,title,spec,quantity,status,order_time:chinaTime(required('订单创建时间')),shipped_at,source_updated_at:null,amount:detail.line_amount,cost:null,buyer_remark:v('用户备注'),seller_remark:v('包裹备注信息'),remarks_available:true,tracking_numbers:splitWaybills(v('快递单号')),carrier:v('快递公司'),source_details:JSON.stringify(detail)};
}
export function groupXhsLines(lines:OrderLine[]){
 const merged=new Map<string,OrderLine>(),totals=new Map<string,number>();
 for(const line of lines){const group=JSON.stringify([line.shop,line.order_id]),d=sourceDetails(line)!;totals.set(group,(totals.get(group)??0)+Math.round(d.line_amount*100));const old=merged.get(line.key);
  if(!old){merged.set(line.key,{...line});continue;}
  const od=sourceDetails(old)!;
  if(old.status!==line.status||old.spec!==line.spec||old.shipped_at!==line.shipped_at||old.order_time!==line.order_time||old.buyer_remark!==line.buyer_remark||old.seller_remark!==line.seller_remark||od.after_sale!==d.after_sale)throw Error('同一订单同一商家编码存在不同规格或状态，请核对：'+line.order_id+' / '+line.code);
  old.quantity+=line.quantity;old.tracking_numbers=[...new Set([...(old.tracking_numbers??[]),...(line.tracking_numbers??[])])];old.source_details=JSON.stringify({...od,sku_ids:[...od.sku_ids,...d.sku_ids],line_amount:Math.round((od.line_amount+d.line_amount)*100)/100,buyer_amount:Math.round((od.buyer_amount+d.buyer_amount)*100)/100});
 }
 return [...merged.values()].map(o=>({...o,amount:totals.get(JSON.stringify([o.shop,o.order_id]))!/100}));
}
export function mapSourceShops(lines:OrderLine[],mappings:SourceShopMapping[]){return lines.map(o=>{const source=sourceDetails(o);if(!source)return o;const m=mappings.find(x=>x.source==='xiaohongshu'&&x.source_shop===source.shop_name);if(!m)return o;return {...o,shop:m.shop,platform:m.platform,key:JSON.stringify([m.shop,o.order_id,o.code||'未填编码:'+o.title+':'+o.spec])};});}
export function crossSourceDuplicates(incoming:OrderLine[],existing:OrderLine[]){const groups=new Map<string,OrderLine[]>();for(const o of existing){const a=groups.get(o.order_id)??[];a.push(o);groups.set(o.order_id,a);}return incoming.filter(o=>(groups.get(o.order_id)??[]).some(old=>old.shop!==o.shop&&(sourceDetails(o)||sourceDetails(old))));}
export function validateSource(raw:OrderLine,old?:OrderLine,confirmShipment=false){
 if(!raw.source_details)return old?.source_details??'';
 if(typeof raw.source_details!=='string'||raw.source_details.length>12000)throw Error('订单来源信息无效');
 const d=sourceDetails(raw);if(!d||typeof d.shop_name!=='string'||!d.shop_name||d.shop_name.length>160||typeof d.status!=='string'||typeof d.after_sale!=='string'||d.after_sale.length>100||!Array.isArray(d.sku_ids)||!d.sku_ids.length||d.sku_ids.some(x=>typeof x!=='string'||x.length>200))throw Error('小红书来源字段无效');
 if(normalizeXhsStatus(d.status)!==raw.status)throw Error('小红书原状态与导入状态不一致');
 for(const n of [d.line_amount,d.buyer_amount])if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e8)throw Error('小红书原始金额无效');
 const prior=old?sourceDetails(old):null;
 return JSON.stringify({kind:'xiaohongshu',shop_name:d.shop_name,status:d.status,after_sale:d.after_sale,sku_ids:d.sku_ids,line_amount:d.line_amount,buyer_amount:d.buyer_amount,...(confirmShipment||prior?.shipment_confirmed?{shipment_confirmed:true}:{})});
}
