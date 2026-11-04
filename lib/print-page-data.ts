import {createLinkedPrintEstimator} from './named-print-rules';
import {printTaskGroups,printGroup,type PrintData} from './printing';
import type {OrderLine,Product} from './model';

function calculate(orders:OrderLine[],products:Product[],data:PrintData){
 const groups=printTaskGroups(orders,data.printJobs),estimate=createLinkedPrintEstimator(products,data);
 return {groups,jobs:new Map(data.printJobs.map(j=>[printGroup(j),j])),estimates:new Map([...groups].map(([key,lines])=>[key,estimate(lines)]))};
}
// Preserve the result when navigating away and back. New server data or edited
// rules invalidate it; filter/search/page changes do not redo all calculations.
const cache=new WeakMap<OrderLine[],{refs:unknown[];value:ReturnType<typeof calculate>}>();
export function printingPageData(orders:OrderLine[],products:Product[],data:PrintData){
 const refs=[products,data.printJobs,data.printRules,data.printRuleLinks,data.printRuleMatches],old=cache.get(orders);
 if(old&&refs.every((v,i)=>v===old.refs[i]))return old.value;
 const value=calculate(orders,products,data);cache.set(orders,{refs,value});return value;
}
