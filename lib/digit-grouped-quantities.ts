// Colour tokens have already been resolved against the available stock colours.
// Each “各N份” applies only to the preceding, still unquantified colour group.
export function groupedColorQuantities(text:string,numberText:string,count:(value:string)=>number){
 const events=new RegExp('§([^§]+)§(?:[×x*：:]?('+numberText+')(?:份|套|组|张|件|个)?)?|各('+numberText+')(?:份|套|组|张|件|个)?','g');
 const prefix=new RegExp('('+numberText+')(?:份|套|组|张|件|个)(?:是|要|为)?(?:默认的)?$');
 const items:{color:string;quantity:number}[]=[],waiting:string[]=[];
 let end=0;
 for(const event of text.matchAll(events)){
  const gap=text.slice(end,event.index);
  // Prefix quantities mixed with “各” are not safe to silently discard.
  if(event[1]&&prefix.test(gap))return null;
  end=event.index!+event[0].length;
  if(event[1]){
   if(event[2])items.push({color:event[1],quantity:count(event[2])});
   else waiting.push(event[1]);
  }else{
   if(!waiting.length)return null;
   for(const color of waiting)items.push({color,quantity:count(event[3])});
   waiting.length=0;
  }
 }
 return waiting.length?null:items;
}
