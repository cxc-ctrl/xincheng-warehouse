import type {OrderLine} from './model';

export function needsReplacementReview(order:Pick<OrderLine,'buyer_remark'|'seller_remark'>){
 return [order.buyer_remark,order.seller_remark].some(remark=>
  remark?.split(/[；;。\n]/).some(part=>!/(?:无需|不用|不需|不必|不予|不要|取消)\s*(?:换|改|替)/.test(part)&&/[换改替](?:发|寄)|换(?:成|为|货|款)|发.{0,10}(?:代替|替代)/.test(part)));
}
