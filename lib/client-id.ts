// randomUUID is limited to secure contexts; getRandomValues also works on HTTP.
export function clientId(): string {
 const source=globalThis.crypto;
 if(typeof source?.randomUUID==="function")return source.randomUUID();
 if(typeof source?.getRandomValues!=="function")throw new Error("浏览器无法生成操作编号，请使用新版 Chrome 或 Edge 浏览器");
 const bytes=source.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&0x0f)|0x40;
 bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
