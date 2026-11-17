// Optional lossless wire format. Repeated long strings and row headings are sent
// once; callers without transport=compact continue receiving ordinary JSON.
type Node=null|boolean|number|string|{s:number}|{a:Node[]}|{o:[string,Node][]}|{t:[string[],Node[][]]}|{u:1};
export type WarehouseTransport={format:'warehouse-compact-v1';strings:string[];data:Node};
export function packWarehouse(value:unknown):WarehouseTransport{
 const counts=new Map<string,number>();
 function count(v:unknown){if(typeof v==='string'){if(v.length>=32)counts.set(v,(counts.get(v)??0)+1);}else if(Array.isArray(v))v.forEach(count);else if(v&&typeof v==='object')Object.values(v).forEach(count);}
 count(value);const strings=[...counts].filter(([,n])=>n>1).map(([s])=>s),ids=new Map(strings.map((s,i)=>[s,i]));
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 function encode(v:unknown):Node{
  if(v===undefined)return {u:1};
  if(typeof v==='string')return ids.has(v)?{s:ids.get(v)!}:v;
  if(v===null||typeof v==='number'||typeof v==='boolean')return v;
  if(Array.isArray(v)){
   if(v.length>2&&v.every(object)){const keys=[...new Set(v.flatMap(r=>Object.keys(r)))];return {t:[keys,v.map(r=>keys.map(k=>encode(Object.hasOwn(r,k)?r[k]:undefined)))]};}
   return {a:v.map(encode)};
  }
  return {o:Object.entries(v as Record<string,unknown>).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encode(v)])};
 }
 return {format:'warehouse-compact-v1',strings,data:encode(value)};
}
export function unpackWarehouse<T>(input:T|WarehouseTransport):T{
 if(!input||typeof input!=='object'||!('format' in input)||input.format!=='warehouse-compact-v1')return input as T;
 const {strings,data}=input as WarehouseTransport;
 function decode(v:Node):unknown{
  if(v===null||typeof v!=='object')return v;
  if('s' in v)return strings[v.s];if('u' in v)return undefined;
  if('a' in v)return v.a.map(x=>decode(x)??null);
  if('t' in v){const [keys,rows]=v.t;return rows.map(row=>Object.fromEntries(keys.flatMap((key,i)=>{const value=decode(row[i]);return value===undefined?[]:[[key,value]]})));}
  return Object.fromEntries(v.o.map(([key,value])=>[key,decode(value)]));
 }
 return decode(data) as T;
}
