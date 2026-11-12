import {digitOrderIssue} from '../lib/order-issues';
import type {DigitFulfillment} from '../lib/digit-colors';

export default function OrderIssue({choice}:{choice:DigitFulfillment|undefined}){
 if(choice?.historical_counted)return <div className="order-issue"><strong>已包含在后续盘点中</strong><small>无需再次盘点或补扣库存，历史订单保留。</small></div>;
 if(choice?.status==='print')return <div className="order-issue printed"><strong>已安排打印</strong><small>{choice.reason.includes('已变化')?choice.reason:"整单打印 · 不扣现货 · 打印成本待设置"}</small></div>;
 const issue=digitOrderIssue(choice);
 return issue?<div className={'order-issue '+issue.tone}><strong>{issue.label}</strong><small>{issue.detail}</small></div>:null;
}
