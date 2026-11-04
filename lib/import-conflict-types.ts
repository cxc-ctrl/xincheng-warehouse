import type {OrderLine} from './model';
export type ImportConflictRow={sheet:string;row:number;values:Record<string,string>;line:OrderLine};
export type ImportConflictGroup={key:string;shop:string;order_id:string;code:string;reason:string;rows:ImportConflictRow[]};
export type StagedImportConflict={id:string;order_key:string;shop:string;order_id:string;code:string;filename:string;payload:string;status:string;created_at:number;resolved_at:number|null;resolution:string;old_order:string};
