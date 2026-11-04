import type {OrderLine} from './model';

// One request only. Reads happen while statements are being assembled; the
// original atomic batch still runs every write and every concurrency guard.
export async function importReadContext(base:D1Database,scope:string,lines:OrderLine[]):Promise<D1Database>{
 const cache=new Map<string,Promise<unknown>>();
 const native=new WeakMap<object,D1PreparedStatement>();
 const signatures=new WeakMap<object,string>();
 const key=(q:string,args:unknown[],method:string)=>JSON.stringify([q,args,method]);
 const remember=(k:string,read:()=>Promise<unknown>)=>{if(!cache.has(k))cache.set(k,read());return cache.get(k)!;};
 const wrap=(q:string,args:unknown[]=[]):D1PreparedStatement=>{
  const statement=args.length?base.prepare(q).bind(...args):base.prepare(q);
  const proxy=new Proxy(statement,{get(target,property){
   if(property==='bind')return (...values:unknown[])=>wrap(q,values);
   if(property==='first'||property==='all')return (...options:unknown[])=>remember(key(q,args,String(property)+JSON.stringify(options)),()=>Reflect.apply(Reflect.get(target,property),target,options)).then(value=>structuredClone(value));
   const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  native.set(proxy,statement);signatures.set(proxy,key(q,args,'batch'));return proxy;
 };
 const seed=(q:string,args:unknown[],value:unknown)=>cache.set(key(q,args,'first[]'),Promise.resolve(value));
 const keys=JSON.stringify(lines.map(o=>o.key)),codes=JSON.stringify([...new Set(lines.map(o=>o.code))]);
 const groups=JSON.stringify([...new Set(lines.map(o=>JSON.stringify([o.shop,o.order_id])))].map(s=>JSON.parse(s)));
 const results=await base.batch([
  base.prepare('SELECT * FROM orders WHERE scope=? AND key IN(SELECT value FROM json_each(?))').bind(scope,keys),
  base.prepare('SELECT * FROM digit_fulfillments WHERE scope=? AND order_key IN(SELECT value FROM json_each(?))').bind(scope,keys),
  base.prepare('SELECT * FROM products WHERE scope=? AND code IN(SELECT value FROM json_each(?))').bind(scope,codes),
  base.prepare('SELECT * FROM product_supply_profiles WHERE scope=? AND code IN(SELECT value FROM json_each(?))').bind(scope,codes),
  base.prepare("SELECT * FROM print_jobs WHERE scope=? AND (shop,order_id) IN(SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))").bind(scope,groups),
 ]);
 const maps=results.map((r,i)=>new Map((r.results as Record<string,unknown>[]).map(row=>[i===4?JSON.stringify([row.shop,row.order_id]):String(row[i===0?'key':i===1?'order_key':'code']),row])));
 for(const o of lines){
  seed('SELECT * FROM orders WHERE scope=? AND key=?',[scope,o.key],maps[0].get(o.key)??null);
  seed('SELECT * FROM digit_fulfillments WHERE scope=? AND order_key=?',[scope,o.key],maps[1].get(o.key)??null);
  seed('SELECT * FROM product_supply_profiles WHERE scope=? AND code=?',[scope,o.code],maps[3].get(o.code)??null);
  seed('SELECT * FROM print_jobs WHERE scope=? AND shop=? AND order_id=?',[scope,o.shop,o.order_id],maps[4].get(JSON.stringify([o.shop,o.order_id]))??null);
  const p=maps[2].get(o.code);
  seed('SELECT name FROM products WHERE scope=? AND code=?',[scope,o.code],p?{name:p.name}:null);
  seed('SELECT tracking_at,cost,stock_mode FROM products WHERE scope=? AND code=?',[scope,o.code],p?{tracking_at:p.tracking_at,cost:p.cost,stock_mode:p.stock_mode}:null);
 }
 return new Proxy(base,{get(target,property){
  if(property==='prepare')return wrap;
  if(property==='batch')return async (statements:D1PreparedStatement[])=>{
   // Cache read-only configuration batches; never cache transaction guards.
   const sigs=statements.map(s=>signatures.get(s));
   const readOnly=sigs.every(s=>s&&/^SELECT (?!CASE\b)/i.test(JSON.parse(s)[0]));
   const run=()=>base.batch(statements.map(s=>native.get(s)??s));
   if(readOnly)return structuredClone(await remember(JSON.stringify(sigs),run));
   cache.clear();return run();
  };
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }}) as D1Database;
}
