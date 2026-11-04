import {parseOrders} from './xlsx';

export async function parseOrdersInWorker(file:File,onProgress:(message:string)=>void):Promise<Awaited<ReturnType<typeof parseOrders>>>{
 onProgress('正在读取Excel…');
 if(typeof Worker==='undefined')return parseOrders(file,{onProgress});
 return new Promise((resolve,reject)=>{
  let worker:Worker;
  try{worker=new Worker(new URL('./order-parser.worker.ts',import.meta.url));}
  catch{parseOrders(file,{onProgress}).then(resolve,reject);return;}
  worker.onmessage=event=>{
   const data=event.data;
   if(data.type==='progress'){onProgress(data.message);return;}
   worker.terminate();
   if(data.type==='result')resolve(data.result);else reject(new Error(data.message));
  };
  worker.onerror=()=>{worker.terminate();reject(new Error('后台读取未完成，请刷新页面后重新选择文件；尚未写入订单。'));};
  worker.postMessage({file});
 });
}
