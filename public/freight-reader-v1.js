/* Local SheetJS 0.20.3 parser. Bill contents stay in this browser. */
importScripts('/vendor/xlsx-0.20.3.full.min.js');
self.onmessage=async({data})=>{try{
 const file=data.file;if(!file||file.size>40*1024*1024)throw Error('单份账单不能超过40MB，请拆分后上传');
 const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellFormula:false,cellHTML:false,cellStyles:false,dense:true,raw:true});
 let count=0;const sheets=book.SheetNames.map(name=>{const sheet=book.Sheets[name],ref=sheet['!ref'];if(!ref)return {name,rows:[]};const range=XLSX.utils.decode_range(ref);if(range.e.r>200000||range.e.c>1024)throw Error('账单行列过多，请删除多余空白区域后重试');const rows=[];
 for(let r=range.s.r;r<=range.e.r;r++){const values={};for(let c=range.s.c;c<=range.e.c;c++){const cell=sheet['!data']?.[r]?.[c];if(!cell||cell.v==null)continue;let v=cell.t==='e'?'#ERROR':typeof cell.v==='number'?String(Number(cell.v.toFixed(8))):String(cell.v).trim();if(v)values[XLSX.utils.encode_col(c)]=v;}if(Object.keys(values).length){rows.push({row:r+1,values});if(++count>200000)throw Error('账单总行数超过20万，请分批上传');}}
 return {name,rows};});self.postMessage({sheets});
 }catch(e){self.postMessage({error:e.message||'无法读取账单，请确认文件未加密且格式正确'});}};
