import type {DigitFulfillment} from './digit-colors';

export const DIGIT_ISSUE_LABELS=['建议整单打印','缺货','未建对应库存','备注无法识别','规格 / 数量需核对','待盘点','已扣记录待复核','发货方式需核对'] as const;
export type DigitIssue={label:typeof DIGIT_ISSUE_LABELS[number];tone:'shortage'|'missing'|'unknown'|'review';detail:string};
export function digitOrderIssue(choice:Pick<DigitFulfillment,'status'|'reason'|'historical_counted'>|undefined):DigitIssue|null{
 if(choice?.historical_counted||choice?.status!=='pending')return null;
 const detail=choice.reason||'请查看买家与卖家备注，确认实际发货要求';
 if(/商品制作方式已更新|供货方式.*更新|发货方式.*变化/.test(detail))return {label:'发货方式需核对',tone:'review',detail};
 if(detail.startsWith('建议整单打印'))return {label:'建议整单打印',tone:'review',detail};
 if(/已扣记录待复核|原扣减.*保留/.test(detail))return {label:'已扣记录待复核',tone:'review',detail};
 if(/缺少.*版面|无法匹配.*版面|超出.*备货范围|未配置对应库存|未建对应库存|请先建立完整实物关联|已移除/.test(detail))return {label:'未建对应库存',tone:'missing',detail};
 if(/库存不足/.test(detail))return {label:'缺货',tone:'shortage',detail};
 if(/待盘点|未盘点|尚未盘点|库存尚未确认/.test(detail))return {label:'待盘点',tone:'review',detail};
 if(/非标准|尺寸|数字范围|数量|份数|种数|定制|额外|随机/.test(detail))return {label:'规格 / 数量需核对',tone:'review',detail};
 return {label:'备注无法识别',tone:'unknown',detail};
}

