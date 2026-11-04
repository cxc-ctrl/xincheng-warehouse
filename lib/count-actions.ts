// Rebase only the selected inventory record. Receipt guards and D1 batch keep
// metadata + count confirmation atomic, including retries and concurrent imports.
export function appendInventoryCount(
 d: D1Database, statements: D1PreparedStatement[], scope: string,
 code: string, quantity: number, at: number, now: number, rid: string,
 guard: string, physical = false, unit = "张",
) {
 const note = "确认真实库存 " + quantity + (physical ? unit : "（按商品库存单位）") + "；盘点截止时间 " + new Date(at).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai",hour12:false});
 const table = physical ? "physical_stocks" : "products";
 statements.push(d.prepare(`INSERT INTO movements(scope,id,code,kind,type,delta,note,at,reference,unit) SELECT scope,?,code,?,?,?-COALESCE(quantity,0),?,?,?,unit FROM ${table} WHERE scope=? AND code=? AND ${guard}`)
  .bind(crypto.randomUUID(), physical ? "physical" : "product", physical ? "实物盘点" : "盘点", quantity, note, now, rid, scope, code, scope, rid));
 if (physical) {
  statements.push(d.prepare(`UPDATE order_stocks SET deducted_qty=0,reset=1 WHERE scope=? AND stock_code=? AND ${guard}`).bind(scope, code, scope, rid));
 } else {
  statements.push(d.prepare(`UPDATE orders SET deducted_qty=0,reset=1 WHERE scope=? AND code=? AND ${guard}`).bind(scope, code, scope, rid));
 }
 statements.push(d.prepare(`UPDATE ${table} SET quantity=?,count_at=?,updated_at=? WHERE scope=? AND code=? AND ${guard}`).bind(quantity, at, now, scope, code, scope, rid));
 // Backdated counts must retain later receipts, returns and manual adjustments.
 // Order deductions are replayed separately; count/replay audit rows are not receipts.
 statements.push(d.prepare(`UPDATE ${table} SET quantity=quantity+COALESCE((SELECT SUM(delta) FROM movements WHERE scope=? AND code=? AND kind=? AND COALESCE(effective_at,at)>? AND (type LIKE '%补货入库' OR type LIKE '%人工调整' OR type IN ('退货入库','采购入库','损坏出库','销毁出库','撤销报损'))),0) WHERE scope=? AND code=? AND ${guard}`)
  .bind(scope,code,physical?'physical':'product',at,scope,code,scope,rid));
 statements.push(d.prepare(`UPDATE ${table} SET quantity=quantity+COALESCE((SELECT SUM(quantity) FROM print_stock_corrections WHERE scope=? AND code=? AND kind=? AND shipment_at<=? AND returned_at>?),0) WHERE scope=? AND code=? AND ${guard}`)
  .bind(scope,code,physical?'physical':'product',at,at,scope,code,scope,rid));
 if (!physical) {
  statements.push(d.prepare(`UPDATE orders SET deducted_qty=shipped_qty,reset=0,updated_at=? WHERE scope=? AND code=? AND shipped_qty>0 AND COALESCE(shipped_at,order_time)>? AND ${guard}`).bind(now, scope, code, at, scope, rid));
 }
 // For paper counts, the caller replays orders after all selected papers have
 // been rebased, so a multi-page recipe is processed against consistent counts.
}
