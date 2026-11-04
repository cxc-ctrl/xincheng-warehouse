// Isolated business checks: no network calls, local user DB, or real stock writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),sql=new DatabaseSync(':memory:');
for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>/^\d+.*\.sql$/.test(f)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async first(){return sql.prepare(this.query).get(...this.args)??null;}
 async all(){return {results:sql.prepare(this.query).all(...this.args)};}
}
const db={prepare:q=>new Statement(q),batch:async statements=>{
 sql.exec('BEGIN');try{const results=statements.map(s=>/^\s*SELECT/i.test(s.query)?{results:sql.prepare(s.query).all(...s.args)}:{results:[],meta:sql.prepare(s.query).run(...s.args)});sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}
}};
const cache=new Map();
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const localRequire=name=>{
  if(name==='cloudflare:workers'||name.endsWith('/server/runtime'))return {env:{DB:db}};
  if(name.endsWith('chatgpt-auth'))return {getChatGPTUser:async()=>({userId:'isolated',displayName:'Isolated test'})};
  if(name.startsWith('.')){let target=path.resolve(path.dirname(file),name);if(target.endsWith('.json'))return JSON.parse(fs.readFileSync(target,'utf8'));if(!path.extname(target))target+='.ts';return load(target);}
  return require(name);
 };
 vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(module.exports,localRequire,module);
 return module.exports;
}
const route=load(path.join(root,'app/api/warehouse/route.ts'));
const model=load(path.join(root,'lib/model.ts'));
const plan=load(path.join(root,'lib/paper-plan.ts'));
async function send(body,expected=200){const response=await route.POST(new Request('http://isolated.test/api/warehouse',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://isolated.test'},body:JSON.stringify({request_id:crypto.randomUUID(),...body})}));const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;}
async function data(){const r=await route.GET();assert.equal(r.status,200);return r.json();}
async function product(code,name,extra={}){await send({action:'product',new_product:true,product:{code,name,category:'隔离测试',stock_mode:'recipe',...extra}});}
function line(id,code,quantity,status='已发货',at=Date.now()+1000){return {key:JSON.stringify(['isolated',id,code]),order_id:id,shop:'isolated',platform:'test',code,title:code,spec:'',quantity,status,order_time:at,amount:10,cost:null};}
async function imported(lines,id=crypto.randomUUID()){const b={action:'import',request_id:id,batch_id:id,filename:'isolated-test',lines,final:true};await send(b);return b;}
function qty(code){return sql.prepare("SELECT quantity FROM physical_stocks WHERE scope='isolated' AND code=?").get(code)?.quantity;}

module.exports={assert,sql,db,load,route,model,plan,send,data,product,line,imported,qty,root};

