"use client";
import './cost-settings.css';
import {type CostSettings} from '../lib/fulfillment';
import type {StockCostDraft} from '../lib/stock-cost';
export {stockCostDraft,inventoryCostPayload} from '../lib/stock-cost';
export type {StockCostDraft} from '../lib/stock-cost';

type FieldProps={draft:StockCostDraft;settings:CostSettings;onChange:(d:StockCostDraft)=>void;unit:string;disabled?:boolean;label?:string};

export function StockUnitCostInput({draft,onChange,unit,disabled=false,label}:FieldProps){
 return <input type="number" min="0" step="any" disabled={disabled} aria-label={label??`货品成本（元/${unit}）`} value={draft.unit_cost} placeholder="未填写" title="留空不修改货品成本" onChange={e=>onChange({...draft,unit_cost:e.target.value})}/>;
}

export default function StockCostFields(props:FieldProps){
 const {unit,disabled=false}=props;
 return <fieldset className="stock-cost-fields stock-cost-compact" disabled={disabled}><div className="stock-cost-inputs stock-cost-only">
  <label>货品成本（元/{unit}）<StockUnitCostInput {...props}/></label>
 </div></fieldset>;
}
