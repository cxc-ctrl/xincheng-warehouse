import {DOMParser,onErrorStopParsing} from '@xmldom/xmldom';
import {parseOrders} from './xlsx';

self.onmessage=async (event:MessageEvent<{file:File}>)=>{
 try{
  const result=await parseOrders(event.data.file,{
   parseXml:source=>new DOMParser({onError:onErrorStopParsing}).parseFromString(source,'application/xml') as unknown as Document,
   onProgress:message=>self.postMessage({type:'progress',message}),
  });
  self.postMessage({type:'result',result});
 }catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:'表格读取失败'});}
};
