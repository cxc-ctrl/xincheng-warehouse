type Obj=Record<string,any>;
export const AUTO_COST='按实物自动计算',FIXED_COST='固定整份成本';
export function priceNumber(raw:unknown,label:string):number|null{
 if(raw==null||raw==='')return null;
 if(typeof raw!=='number'&&typeof raw!=='string')throw new Error(label+'格式无效');
 const n=Number(raw);if(!Number.isFinite(n)||n<0||n>1e8||typeof raw==='string'&&!/^\d+(\.\d{1,8})?$/.test(raw.trim())||Math.abs(n-Number(n.toFixed(8)))>1e-12)throw new Error(label+'须为非负数字，最多8位小数');
 return n;
}
export function stockPrice(raw:Obj){
 const s={...raw},mode=s.pricing_mode||'直接填单价';if(!['直接填单价','按总价换算'].includes(mode))throw new Error('实物计价方式无效');
 s.pricing_mode=mode;s.quote_unit=s.quote_unit||s.unit;
 const q=priceNumber(s.quote_qty,'计价数量'),total=priceNumber(s.quote_total,'货品总价'),each=priceNumber(s.units_per_quote,'单位换算数量')??1;
 if(!Number.isSafeInteger(each)||each<=0)throw new Error('单位换算数量须为正整数');
 s.quote_qty=q;s.quote_total=total;s.units_per_quote=mode==='按总价换算'?each:s.units_per_quote??null;
 if(mode==='按总价换算'){
  if(q!=null&&(!Number.isSafeInteger(q)||q<=0))throw new Error('计价数量须为正整数');
  if(s.quote_unit===s.unit&&each!==1)throw new Error('同一单位换算数量必须为1');
  if(q==null||total==null)s.cost=null;
  else{const scaled=BigInt(total.toFixed(8).replace('.','')),den=BigInt(q)*BigInt(each);s.cost=Number((scaled+den/BigInt(2))/den)/1e8;}
 }else s.cost=priceNumber(s.cost,'实物单位成本');
 return s;
}
