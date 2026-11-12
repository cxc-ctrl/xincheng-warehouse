import {parseNumberRange} from './paper-plan';
import type {DigitCondition} from './warehouse-digit-conditions';
export function transparentDigitRange(name:string,conditions:DigitCondition[],spec?:string){
 const size=name.match(/^透明\s*(\d+(?:\.\d+)?)\s*cm数字贴/i);
 if(!size)return null;
 const condition=conditions.find(c=>c.color==='透明'&&c.size===Number(size[1]));
 if(!condition)return null;
 const range=parseNumberRange(spec||'')||parseNumberRange(name);
 return {condition,range,outside:!condition.enabled||!range||range.start<condition.start||range.end>condition.end};
}
