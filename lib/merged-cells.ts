export type TableRow={row:number;values:Record<string,string>};
export const normalizeTableHeader=(value:string)=>value.replace(/\s/g,"").toUpperCase();

// Only explicit vertical merges in selected metadata columns are inherited.
// Orders, counts, prices and unmerged blanks must not gain fabricated values.
export function inheritMergedFields(rows:TableRow[],refs:string[],headers:string[]){
 const labels=new Set(headers.map(normalizeTableHeader));
 const columns=new Set(rows.flatMap(r=>Object.entries(r.values).filter(([,v])=>labels.has(normalizeTableHeader(v))).map(([c])=>c)));
 const byRow=new Map(rows.map(r=>[r.row,r]));
 for(const ref of refs){
  const m=ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if(!m||m[1]!==m[3]||!columns.has(m[1]))continue;
  const start=Number(m[2]),end=Number(m[4]),value=byRow.get(start)?.values[m[1]];
  if(!value||labels.has(normalizeTableHeader(value)))continue;
  // Iterate actual data rows, not an arbitrary (possibly whole-column) range.
  for(const row of rows)if(row.row>start&&row.row<=end&&!row.values[m[1]])row.values[m[1]]=value;
 }
 return rows;
}
