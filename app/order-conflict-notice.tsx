import type {ConflictReview} from '../lib/order-conflict-review';
import './order-conflict-notice.css';
export default function OrderConflictNotice({review}:{review:ConflictReview}){
 return <div className="order-conflict-notice"><strong>{review.label}</strong>{review.changes.map(c=><small key={c.field}>{c.field}：{c.before} → {c.after}</small>)}<small className="order-conflict-check">需核对：{review.instruction}</small></div>;
}
