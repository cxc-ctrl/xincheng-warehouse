/** Only obsolete product-center generated rules are eligible. Manual rules are never collected. */
export const generatedPrintRule = (id:string)=>/^pc:AUTO-SHEET-[A-F0-9]{20}$/.test(id);

// Evaluated inside the sync transaction, after every link/profile in this batch
// has moved. Other batches, order overrides, conditions and historical snapshots
// retain their rules. Use literal instr, not LIKE (IDs can contain wildcards).
export const unreferencedPrintRuleSQL = `
 NOT EXISTS(SELECT 1 FROM print_rule_links l WHERE l.scope=print_rules.scope AND l.rule_id=print_rules.id)
 AND NOT EXISTS(SELECT 1 FROM print_rule_matches m WHERE m.scope=print_rules.scope AND m.rule_id=print_rules.id)
 AND NOT EXISTS(SELECT 1 FROM warehouse_digit_conditions c WHERE c.scope=print_rules.scope AND c.print_rule_id=print_rules.id)
 AND NOT EXISTS(SELECT 1 FROM product_supply_profiles p WHERE p.scope=print_rules.scope AND instr(p.config,substr(print_rules.id,4))>0)
 AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.scope=print_rules.scope AND (instr(j.basis,print_rules.id)>0 OR instr(COALESCE(j.estimate_snapshot,''),print_rules.id)>0))
 AND NOT EXISTS(SELECT 1 FROM print_events e WHERE e.scope=print_rules.scope AND instr(e.note,print_rules.id)>0)
`;

export function appendObsoletePrintRuleCleanup(d:D1Database,scope:string,candidates:string[],rid:string,guard:string,ss:D1PreparedStatement[]){
 const ids=[...new Set(candidates.filter(generatedPrintRule))];
 if(!ids.length)return;
 ss.push(d.prepare(`DELETE FROM print_rules WHERE scope=? AND id IN(SELECT value FROM json_each(?)) AND ${guard} AND ${unreferencedPrintRuleSQL}`).bind(scope,JSON.stringify(ids),scope,rid));
}
