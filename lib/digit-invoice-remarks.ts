// Remove billing annotations only. Keep the stored original remark and all
// unrelated colour, quantity, size and number-range instructions intact.
export function withoutInvoiceAnnotations(raw:string){
 const date='(?<!\\d)(?:20\\d{2}[-/.年])?(?:0?[1-9]|1[0-2])[-/.月](?:0?[1-9]|[12]\\d|3[01])日?(?!\\d)';
 const invoice='(?:已|需|要|登记|补开|补|开|带|附|随货|电子|纸质|专用|增值税|普通|的)*发票';
 return raw.normalize('NFKC')
  .replace(new RegExp(date+'\\s*'+invoice,'g'),'')
  .replace(new RegExp(invoice+'(?:日期|时间|登记)?[：:]?\\s*'+date,'g'),'')
  .replace(/(?:不要|不用|无需|需要|请|要|带|随货|附|登记|补开|开具|开|已|电子|纸质|普通|增值税|专用|红字|蓝字)*发票(?:[：:]?\s*(?:\d+|一|两|二)(?:份|张))?/g,'');
}
