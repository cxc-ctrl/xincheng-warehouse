'use client';
import {sourceDetails,sourceNeedsReview,type SourceShopMapping} from '../lib/order-sources';
import type {OrderLine} from '../lib/model';
import type {Shop} from '../lib/shops';
type Props={lines:OrderLine[];shops:Shop[];saved:SourceShopMapping[];busy:boolean;confirmed:boolean;onConfirm:(v:boolean)=>void;onMap:(mapping:SourceShopMapping)=>void};
export default function OrderSourcePreview({lines,shops,saved,busy,confirmed,onConfirm,onMap}:Props){
 const names=[...new Set(lines.map(o=>sourceDetails(o)?.shop_name).filter((v):v is string=>!!v))],reviews=lines.filter(sourceNeedsReview).length,closed=lines.filter(o=>o.status==='已关闭'&&o.shipped_at).length;
 return <section className="note-box source-import-preview"><strong>已识别：小红书订单</strong><p>“商家编码”匹配商品，“SKU件数”按已有包装规则换算库存；同一订单商品金额先求和，再按订单计一次。</p>
 {names.map(name=>{const line=lines.find(o=>sourceDetails(o)?.shop_name===name)!,locked=saved.find(m=>m.source==='xiaohongshu'&&m.source_shop===name);const candidates=shops.filter(s=>s.enabled&&/^(XHS|小红书|xiaohongshu|RED)$/i.test(s.platform));return <label key={name} className="source-shop-select">{name}<select aria-label={`小红书店铺归属 ${name}`} disabled={busy||!!locked} value={JSON.stringify([line.platform,line.shop])} onChange={e=>{const [platform,shop]=JSON.parse(e.target.value);onMap({source:'xiaohongshu',source_shop:name,platform,shop});}}><option value={JSON.stringify(['XHS','XHS:'+name])}>独立小红书店铺：{name}</option>{locked&&!candidates.some(s=>s.code===locked.shop&&s.platform===locked.platform)&&<option value={JSON.stringify([locked.platform,locked.shop])}>{locked.shop}（已关联）</option>}{candidates.map(s=><option key={s.id} value={JSON.stringify([s.platform,s.code])}>{s.name} · {s.code}</option>)}</select><small>{locked?'沿用上次确认的店铺关联。':'已有小红书店铺请选择对应项；否则使用独立店铺，导入后到“店铺配置”设置团队及结算规则。'}</small></label>})}
 <p>{reviews} 条售后/发货异常将进入订单核对，其中 {closed} 条已关闭但有发货记录：首次导入暂不扣库，确认实际发货后按盘点时间处理。未提供退款金额，售后利润不视为已确认。</p>
 <p>表内包裹运费不作为结算成本。快递按后续账单匹配；历史发货不重复扣除已包含在实盘中的库存。</p>
 <label className="confirmation-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>onConfirm(e.target.checked)}/>已核对店铺归属，确认使用上述规则导入</label>
 </section>;
}
