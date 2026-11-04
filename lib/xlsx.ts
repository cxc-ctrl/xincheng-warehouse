import {xhsLine,groupXhsLines,sourceDetails} from './order-sources';
import {splitWaybills} from './freight-reconciliation';
import { chinaTime, type OrderLine } from "./model";
import type {CountInput} from "./stocktake";
import {inheritMergedFields} from "./merged-cells";
type Sheet={name:string;rows:{row:number;values:Record<string,string>}[]};
type TableOptions={mergedHeaders?:string[];parseXml?:(source:string)=>Document;onProgress?:(message:string)=>void};
const decoder=new TextDecoder();
const nodes=(el:Document|Element,name:string)=>Array.from(el.getElementsByTagNameNS("*",name));
function xml(s:string){const d=new DOMParser().parseFromString(s,"application/xml");if(d.querySelector("parsererror"))throw new Error("Excel 内部表格无法读取");return d;}
// Only workbook text members are read, even when the source contains large pictures.
export async function readXlsx(file:File,options:TableOptions={}):Promise<Sheet[]>{
 if(!file.name.toLowerCase().endsWith(".xlsx"))throw new Error("请选择 .xlsx 格式的 Excel 文件");
 const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65557)).arrayBuffer());const tv=new DataView(tail.buffer);let end=-1;
 for(let i=tail.length-22;i>=0;i--)if(tv.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw new Error("文件可能已加密或损坏，请重新导出 Excel");
 const count=tv.getUint16(end+10,true),size=tv.getUint32(end+12,true),offset=tv.getUint32(end+16,true);
 if(size>10*1024*1024||offset+size>file.size||count===65535)throw new Error("文件结构超出支持范围");
 const buf=await file.slice(offset,offset+size).arrayBuffer(),v=new DataView(buf),b=new Uint8Array(buf);const entries=new Map<string,{method:number;size:number;unpacked:number;offset:number}>();let cursor=0;
 for(let i=0;i<count;i++){if(v.getUint32(cursor,true)!==0x02014b50)throw new Error("Excel 目录损坏");const n=v.getUint16(cursor+28,true),e=v.getUint16(cursor+30,true),c=v.getUint16(cursor+32,true);entries.set(decoder.decode(b.slice(cursor+46,cursor+46+n)),{method:v.getUint16(cursor+10,true),size:v.getUint32(cursor+20,true),unpacked:v.getUint32(cursor+24,true),offset:v.getUint32(cursor+42,true)});cursor+=46+n+e+c;}
 let total=0;
 async function get(name:string){const e=entries.get(name);if(!e)throw new Error("Excel 缺少 "+name);total+=e.unpacked;if(e.unpacked>30*1024*1024||total>70*1024*1024)throw new Error("表格文字过大，请分批导出");const h=new DataView(await file.slice(e.offset,e.offset+30).arrayBuffer());const start=e.offset+30+h.getUint16(26,true)+h.getUint16(28,true);const raw=file.slice(start,start+e.size);if(e.method===0)return raw.text();if(e.method!==8)throw new Error("不支持的压缩方式");try{return await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat))).text();}catch{throw new Error("请使用新版 Chrome 或 Edge 浏览器读取 Excel");}}
 const parseXml=options.parseXml??xml;options.onProgress?.('正在读取表格文字…');
 const strings=entries.has("xl/sharedStrings.xml")?nodes(parseXml(await get("xl/sharedStrings.xml")),"si").map(s=>nodes(s,"t").map(t=>t.textContent??"").join("")):[];
 const book=parseXml(await get("xl/workbook.xml")),rels=parseXml(await get("xl/_rels/workbook.xml.rels"));const targets=new Map(nodes(rels,"Relationship").map(r=>[r.getAttribute("Id"),r.getAttribute("Target")??""]));const sheets:Sheet[]=[];
 for(const s of nodes(book,"sheet")){const target=targets.get(s.getAttribute("r:id"))??"";const parts=(target.startsWith("/")?target.slice(1):"xl/"+target).split("/");const resolved:string[]=[];for(const p of parts){if(p==="..")resolved.pop();else if(p&&p!==".")resolved.push(p);}const part=resolved.join("/");if(!entries.has(part))continue;const rows:Sheet["rows"]=[];
  options.onProgress?.('正在读取工作表：'+(s.getAttribute('name')??'Sheet'));
  const doc=parseXml(await get(part));
  for(const r of nodes(doc,"row")){const values:Record<string,string>={};for(const c of nodes(r,"c")){let value=nodes(c,"v")[0]?.textContent??"";if(c.getAttribute("t")==="s")value=strings[Number(value)]??"";if(c.getAttribute("t")==="inlineStr")value=nodes(c,"t").map(t=>t.textContent??"").join("");if(value.trim())values[(c.getAttribute("r")??"").replace(/\d/g,"")]=value.trim();}if(Object.keys(values).length)rows.push({row:Number(r.getAttribute("r")),values});}
  if(options.mergedHeaders)inheritMergedFields(rows,nodes(doc,"mergeCell").map(m=>m.getAttribute("ref")??""),options.mergedHeaders);
  sheets.push({name:s.getAttribute("name")??"Sheet",rows});}
 return sheets;
}
export function optionalTime(get:(label:string)=>string,labels:string[]){
 const value=labels.map(get).find(v=>v&&v.trim());if(!value)return null;
 if(/^\d+(\.\d+)?$/.test(value)){const at=Math.round((Number(value)-25569)*86400000)-8*3600000;if(at<946684800000||at>4102444800000)throw new Error('时间格式无法识别');return at;}
 return chinaTime(value.trim());
}
export async function parseOrders(file:File,options:TableOptions={}){
 const sheets=await readXlsx(file,options),errors:string[]=[],lines=new Map<string,OrderLine>(),seen=new Set<string>();let rawRows=0,duplicateRows=0;const xhs:OrderLine[]=[],xhsSeen=new Map<string,string>();const sources=new Set<string>();
 const sourceRows=new Map<string,import('./import-conflict-types').ImportConflictRow[]>(),conflictReasons=new Map<string,string>();
 for(const sheet of sheets){const head=sheet.rows.find(r=>Object.values(r.values).includes("商家编码")&&Object.values(r.values).includes("订单号"));if(!head)continue;const h=Object.fromEntries(Object.entries(head.values).map(([c,l])=>[l,c]));
 if(h['小红书编码']&&h['SKU件数']){
  sources.add('xiaohongshu');for(const label of ['订单号','商家编码','规格ID','SKU件数','订单状态','售后状态','订单创建时间','订单发货时间','店铺名称','商家应收金额(元)（支付金额）','用户应付金额(元)'])if(!h[label])throw Error('小红书表格缺少必要列：'+label);
  for(const r of sheet.rows.filter(r=>r.row>head.row)){const v=(label:string)=>r.values[h[label]]??'';if(!v('订单号'))continue;rawRows++;try{const line=xhsLine(v),id=JSON.stringify([line.shop,line.order_id,v('规格ID')]),signature=JSON.stringify(line);if(xhsSeen.has(id)){if(xhsSeen.get(id)!==signature)throw Error('相同订单和规格ID存在不同明细，请核对');duplicateRows++;continue;}xhsSeen.set(id,signature);xhs.push(line);}catch(e){errors.push(`${sheet.name} 第 ${r.row} 行：${e instanceof Error?e.message:e}`);}}
  continue;
 }
 sources.add('erp');for(const l of ["订单号","商家编码","数量","订单状态","下单时间","店铺编码"])if(!h[l])throw new Error("缺少必要列："+l);
  for(const r of sheet.rows.filter(r=>r.row>head.row)){const v=(label:string)=>r.values[h[label]]??"";if(!v("订单号"))continue;rawRows++;if(rawRows%1000===0)options.onProgress?.(`正在核对第 ${rawRows} 行订单…`);
   try{const quantity=Number(v("数量"));if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>10000000)throw new Error("数量必须是正整数");const val=(l:string)=>{if(!v(l))return null;const n=Number(v(l));if(!Number.isFinite(n)||n<0)throw new Error(l+"不是有效金额");return n;};const code=v("商家编码");const key=JSON.stringify([...(v("店铺编码").trim()?[]:[v("平台类型")]),v("店铺编码").trim(),v("订单号"),code||"未填编码:"+v("商品标题")+":"+v("规格")]);const waybillLabels=['运单号','快递单号','物流单号','物流运单号','快递运单号'],refundLabels=['退款金额(元)','退款金额','已退款金额'],netLabels=['净实收金额(元)','净实收金额','实收金额(元)'];const firstValue=(labels:string[])=>labels.find(l=>v(l)!=='');const refundLabel=firstValue(refundLabels),netLabel=firstValue(netLabels);const line:OrderLine={...(waybillLabels.some(l=>h[l])?{tracking_numbers:splitWaybills(waybillLabels.map(v).filter(Boolean).join(';')),carrier:v('快递公司')||v('物流公司')}:{}),...(refundLabel?{refund_amount:val(refundLabel)}:{}),...(netLabel?{net_amount:val(netLabel)}:{}),key,order_id:v("订单号"),shop:v("店铺编码"),platform:v("平台类型"),code,title:v("商品标题"),spec:v("规格"),quantity,status:v("订单状态"),order_time:chinaTime(v("下单时间")),amount:val("实付金额(元)"),cost:val("成本(元)"),shipped_at:optionalTime(v,["发货时间","出库时间"]),source_updated_at:optionalTime(v,["订单更新时间","更新时间","最后修改时间"]),buyer_remark:["买家备注","买家留言","买家留言信息"].map(v).filter(Boolean).join("；"),seller_remark:["卖家备注","卖家留言","客服备注","商家备注","订单备注"].map(v).filter(Boolean).join("；"),remarks_available:["买家备注","买家留言","买家留言信息","卖家备注","卖家留言","客服备注","商家备注","订单备注"].some(k=>!!h[k])};const groupRows=sourceRows.get(key)??[];groupRows.push({sheet:sheet.name,row:r.row,values:Object.fromEntries(Object.entries(h).map(([label,col])=>[label,r.values[col]??''])),line:structuredClone(line)});sourceRows.set(key,groupRows);const sig=JSON.stringify(line);if(seen.has(sig)){duplicateRows++;continue;}seen.add(sig);const prior=lines.get(key);
    if(prior){if(prior.platform!==line.platform||prior.status!==line.status||prior.order_time!==line.order_time||prior.spec!==line.spec||prior.buyer_remark!==line.buyer_remark||prior.seller_remark!==line.seller_remark||prior.shipped_at!==line.shipped_at||prior.source_updated_at!==line.source_updated_at)throw new Error("同一订单同一编码存在冲突明细");if(prior.amount!=null&&line.amount!=null)throw new Error("同一商品出现多笔实付金额");for(const field of ['refund_amount','net_amount'] as const)if(prior[field]!=null&&line[field]!=null&&prior[field]!==line[field])throw new Error('同一订单金额信息不一致');prior.quantity+=line.quantity;prior.cost=prior.cost==null||line.cost==null?null:prior.cost+line.cost;prior.amount??=line.amount;prior.tracking_numbers=[...new Set([...(prior.tracking_numbers??[]),...(line.tracking_numbers??[])])];for(const field of ['refund_amount','net_amount'] as const)prior[field]??=line[field];}else lines.set(key,line);
   }catch(e){const reason=e instanceof Error?e.message:String(e),key=JSON.stringify([...(v("店铺编码").trim()?[]:[v("平台类型")]),v("店铺编码").trim(),v("订单号"),v("商家编码")||"未填编码:"+v("商品标题")+":"+v("规格")]);if(["同一订单同一编码存在冲突明细","同一商品出现多笔实付金额","同一订单金额信息不一致"].includes(reason))conflictReasons.set(key,reason);else errors.push(`${sheet.name} 第 ${r.row} 行：${reason}`);}
  }
 }
 if(!rawRows)throw new Error("没有找到订单明细，请使用 ERP 或小红书原始导出格式");
 if(sources.size>1)throw Error('请将ERP和小红书订单分别上传，不要混在同一个文件中');
 try{for(const o of groupXhsLines(xhs))lines.set(o.key,o);}catch(e){errors.push(e instanceof Error?e.message:String(e));}
 const importConflicts:import('./import-conflict-types').ImportConflictGroup[]=[...conflictReasons].map(([key,reason])=>{const rows=sourceRows.get(key)!;const o=rows[0].line;lines.delete(key);return {key,shop:o.shop,order_id:o.order_id,code:o.code,reason,rows};});
 return{importConflicts,source:sources.has('xiaohongshu')?'xiaohongshu' as const:'erp' as const,sourceShops:[...new Set(xhs.map(o=>sourceDetails(o)!.shop_name))],lines:[...lines.values()].filter(o=>o.shop.trim()),heldLines:[...lines.values()].filter(o=>!o.shop.trim()),errors,rawRows,duplicateRows};
}
function csvRows(source:string){
 const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
 for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===","&&!quoted){row.push(cell);cell="";}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&source[i+1]==="\n")i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";}else cell+=c;}
 if(quoted)throw new Error("CSV 引号未闭合");row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export async function readTableFile(file:File,options:TableOptions={}){
 let sheets:Sheet[];
 if(file.name.toLowerCase().endsWith(".csv")){const source=(await file.text()).replace(/^\uFEFF/,"");const rs=csvRows(source);sheets=[{name:"盘点表",rows:rs.map((r,i)=>({row:i+1,values:Object.fromEntries(r.map((v,j)=>[String(j),v.trim()]))}))}];}else sheets=await readXlsx(file,options);
 return sheets;
}
export async function parseCounts(file:File){
 const sheets=await readTableFile(file),items:CountInput[]=[],seen=new Set<string>(),errors:string[]=[];
 for(const sheet of sheets){const h=sheet.rows.find(r=>Object.values(r.values).includes("实盘数量"));if(!h)continue;const labels=Object.fromEntries(Object.entries(h.values).map(([c,l])=>[l.toLowerCase(),c]));const codeCol=labels["实物编码"]??labels["商家编码"]??labels["sku编码"];if(!codeCol)throw new Error("盘点表需要实物编码和实盘数量两列");
  for(const r of sheet.rows.filter(r=>r.row>h.row)){const value=r.values[labels["实盘数量"]]??"";if(value==="")continue;const code=r.values[codeCol]??"",label=r.values[labels["记录类型"]]??"",unit=r.values[labels["库存单位"]]??"";const kind=label==="共用实物"||label==="实物纸张"?"physical":label==="独立成品"?"product":undefined;
   const n=Number(value);if(!code||!Number.isSafeInteger(n)||n<0||n>100000000||(label&&!kind)){errors.push(`第 ${r.row} 行：编码、记录类型或实盘数量无效`);continue;}const key=JSON.stringify([kind??"",code]);if(seen.has(key)){errors.push(`第 ${r.row} 行：实物记录重复 ${code}`);continue;}seen.add(key);items.push({code,quantity:n,...(kind?{kind}:{}),...(unit?{unit}:{})});}
 }
 if(errors.length)throw new Error(errors.slice(0,5).join("；"));if(!items.length)throw new Error("没有找到已填写的实盘数量。请下载盘点模板，填写后再上传；零库存请填 0。");return items;
}
