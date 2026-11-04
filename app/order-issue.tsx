import {digitOrderIssue} from '../lib/order-issues';
import type {DigitFulfillment} from '../lib/digit-colors';

export default function OrderIssue({choice}:{choice:DigitFulfillment|undefined}){
 if(choice?.status==='print')return <div className="order-issue printed"><strong>已安排打印</strong><small>{choice.reason.includes('已变化')?choice.reason:"整单打印 · 不扣现货 · 打印成本待设置"}</small></div>;
 const issue=digitOrderIssue(choice);
 return issue?<div className={'order-issue '+issue.tone}><strong>{issue.label}</strong><small>{issue.detail}</small></div>:null;
}
