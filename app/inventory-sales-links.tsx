import type {InventoryRow,StockRule} from "../lib/model";
import {Pencil} from "lucide-react";
export default function InventorySalesLinks({row,rules=[],onEdit,busy}:{row:InventoryRow;rules:StockRule[];onEdit:(code:string)=>void;busy:boolean}){
 if(row.kind!=="physical")return <small>本 SKU 独立库存</small>;
 if(row.code.startsWith("DIGIT-")&&/cm数字贴/.test(row.name))return <small>内部颜色库存 · 按订单备注和仓库确认扣减</small>;
 if(!row.sales_codes.length)return <small>暂无关联销售规格</small>;
 const items=row.sales_codes.map((code,i)=>({code,name:row.sales_names[i]||code,n:rules.find(r=>r.sales_code===code&&r.stock_code===row.code)?.per_unit})).sort((a,b)=>(a.n??0)-(b.n??0));
 return <details className="inventory-sales-links"><summary>{row.sales_codes.length} 个销售规格共用此库存</summary><ul>{items.map(item=><li key={item.code}><span>{item.name}</span><code>{item.code}</code><div className="inventory-sale-footer"><small>每卖1份，扣 {item.n??"—"} {row.unit}</small><button type="button" className="text-btn inventory-sale-edit" disabled={busy} aria-label={`编辑销售规格 ${item.code}`} onClick={()=>onEdit(item.code)}><Pencil size={14}/>编辑</button></div></li>)}</ul></details>;
}
