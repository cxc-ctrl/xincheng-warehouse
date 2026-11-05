// Browser regression using the actual warehouse Purchasing mount and component.
// All defaults and saves are simulated; no network or business database writes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {build}=require('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/wzqy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
async function main(){
 const mount=fs.readFileSync(path.join(root,'app/warehouse.tsx'),'utf8').split('\n').find(line=>line.includes('<Purchasing focus='));
 assert(mount,'Warehouse purchasing mount must exist');
 const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Purchasing from './app/purchasing';import RetainedView from './app/retained-view';
 const ledger=['蓝莓','柠檬','雪梨'].map((name,i)=>({kind:'physical',code:'STOCK-'+i,name,spec:'7x7',unit:'贴',quantity:2000,sales_codes:[],sales_names:[]}));
 function Harness(){const [purchaseTarget,setPurchaseTarget]=useState(undefined),[view,setView]=useState('products');const purchaseFocus=undefined,loading=false,loadFailed=false,importOpen=false,busy=false,error='';const setError=()=>{},setCounting=()=>{};const paperAction=async body=>{window.saves.push(body);return true};return <>{ledger.map(r=><button key={r.code} onClick={()=>setPurchaseTarget(r)}>{r.name}采购</button>)}<button onClick={()=>setView('purchasing')}>采购管理</button>${mount}</>};window.saves=[];createRoot(document.getElementById('root')).render(<Harness/>);`;
 const result=await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}):route.abort());
 await page.goto('http://purchase.test');
 await page.evaluate(()=>{window.fetch=async(_url,options)=>{const b=JSON.parse(options.body);if(b.action==='purchase_defaults')return {ok:true,json:async()=>({defaults:{supplier:b.code,unit_price:0.02,first:true}})};if(b.action==='purchase_list')return {ok:true,json:async()=>({purchases:{rows:[],count:0,amount_cents:0,pending:0,received:0}})};throw Error('Unexpected request '+b.action)}});
 await page.addScriptTag({content:result.outputFiles[0].text});
 const dialog=page.getByRole('dialog',{name:'增加采购',exact:true});
 async function check(name,code){await page.getByRole('button',{name:name+'采购',exact:true}).click();await dialog.getByText(code,{exact:true}).waitFor();await page.waitForFunction(code=>document.querySelector('[aria-label="采购供应商"]')?.value===code,code);assert(await dialog.getByText(name,{exact:true}).isVisible());}
 await check('蓝莓','STOCK-0');await dialog.getByRole('button',{name:'返回',exact:true}).click();assert.equal(await dialog.count(),0);
 await check('柠檬','STOCK-1');await dialog.getByLabel('采购数量',{exact:true}).fill('300');await dialog.getByRole('button',{name:'保存采购，等待入库',exact:true}).click();assert.equal(await dialog.count(),0);
 await check('雪梨','STOCK-2');assert.equal(await dialog.getByLabel('采购数量',{exact:true}).inputValue(),'');await dialog.getByLabel('采购数量',{exact:true}).fill('400');await dialog.getByRole('button',{name:'保存采购，等待入库',exact:true}).click();
 assert.deepEqual((await page.evaluate(()=>window.saves)).map(b=>[b.code,b.quantity]),[['STOCK-1',300],['STOCK-2',400]]);
 await page.getByRole('button',{name:'采购管理',exact:true}).click();await page.getByRole('button',{name:'增加采购',exact:true}).click();await dialog.getByLabel('搜索采购货品').waitFor();await dialog.getByRole('button').filter({hasText:'雪梨'}).click();await dialog.getByText('STOCK-2',{exact:true}).waitFor();await dialog.getByRole('button',{name:'返回',exact:true}).click();assert.equal(await dialog.count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: close/reopen picks current product, saved codes match, drafts reset, and purchasing-page chooser works; no real writes');
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
