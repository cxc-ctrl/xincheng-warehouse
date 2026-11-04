import type {BillTable} from './freight-import';
export function readFreightFile(file:File):Promise<{name:string;rows:BillTable['rows']}[]>{
 if(!/\.(xlsx|xls|csv)$/i.test(file.name))return Promise.reject(new Error('请选择 XLS、XLSX 或 CSV 账单'));
 return new Promise((resolve,reject)=>{const worker=new Worker('/freight-reader-v1.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('读取账单超时，请拆分文件后重试'));},90000);const done=()=>{clearTimeout(timer);worker.terminate();};worker.onmessage=({data})=>{done();data.error?reject(new Error(data.error)):resolve(data.sheets);};worker.onerror=()=>{done();reject(new Error('账单读取组件加载失败，请刷新后重试'));};worker.postMessage({file});});
}
