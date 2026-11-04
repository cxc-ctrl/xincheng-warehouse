export type Purchase={id:string;kind:'physical'|'product';code:string;name:string;spec:string;unit:string;quantity:number;amount_cents:number;supplier:string;note:string;status:'pending'|'received'|'cancelled';created_at:number;received_at:number|null;updated_at:number};
export type PurchaseList={rows:Purchase[];count:number;amount_cents:number;pending:number;received:number;cancelled:number;page:number};
export const purchaseStatus={pending:'待入库',received:'已入库',cancelled:'已取消'};
export const chinaMonth=(at=Date.now())=>new Date(at+8*3600000).toISOString().slice(0,7);
