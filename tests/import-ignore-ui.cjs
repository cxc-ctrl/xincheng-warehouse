const assert=require('node:assert/strict'),path=require('node:path'),{build}=require('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/wzqy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import Rules from './app/import-ignore-rules';
 window.enabled=1;window.saves=[];window.fetch=async(_url,o)=>{const b=JSON.parse(o.body);return {ok:true,json:async()=>b.action==='import_ignore_list'?{rules:[{id:'scent',pattern:'XLXH-HM-XK',mode:'prefix',note:'香卡',enabled:window.enabled,updated_at:0}],ignored:69}:{preview:{pattern:b.pattern,mode:b.mode,count:2,blocked:1,basis:'[]',sample:[]}}}};
 createRoot(document.getElementById('root')).render(React.createElement(Rules,{busy:false,error:'',onAction:async b=>{window.saves.push(b);if(b.action==='import_ignore_toggle')window.enabled=b.enabled;return true}}));`;
(async()=>{
 const root=path.resolve(__dirname,'..'),r=await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},jsx:'automatic'});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{const p=await browser.newPage();await p.setContent('<div id="root"></div>');await p.addScriptTag({content:r.outputFiles[0].text});await p.getByText('XLXH-HM-XK',{exact:true}).waitFor();
 const save=p.getByRole('button',{name:'确认保存忽略规则',exact:true});assert(await save.isDisabled());assert.equal(await p.getByRole('button',{name:'删除忽略规则 XLXH-HM-XK',exact:true}).count(),0,'active rules cannot be deleted');
 await p.getByLabel('忽略商品编码',{exact:true}).fill('TEST-');await p.getByRole('button',{name:'预览匹配范围',exact:true}).click();
 await p.getByText('其中 1 条已有扣库',{exact:false}).waitFor();assert(await save.isDisabled());
 await p.getByLabel('同时忽略已导入的匹配明细',{exact:false}).uncheck();assert(await save.isEnabled());await save.click();
 assert.equal((await p.evaluate(()=>window.saves))[0].apply_existing,false);await p.getByRole('button',{name:'停用',exact:true}).click();assert.equal((await p.evaluate(()=>window.saves))[1].enabled,0);
 await p.getByRole('button',{name:'删除忽略规则 XLXH-HM-XK',exact:true}).click();const dialog=p.getByRole('dialog',{name:'删除忽略规则',exact:true});await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await p.evaluate(()=>window.saves)).length,2);
 await p.getByRole('button',{name:'删除忽略规则 XLXH-HM-XK',exact:true}).click();await dialog.getByRole('button',{name:'确认删除规则',exact:true}).click();const deletion=(await p.evaluate(()=>window.saves))[2];assert.equal(deletion.action,'import_ignore_delete');assert.equal(deletion.confirm_delete,true);
 console.log('PASS rule UI: preview required, blocked history protected, future-only save and disable action');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
