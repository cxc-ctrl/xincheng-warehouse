import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";
export const products = sqliteTable("products", {
 scope:text("scope").notNull(),code:text("code").notNull(),name:text("name").notNull(),category:text("category").notNull(),
 spec:text("spec").notNull().default(""),pack:text("pack").notNull().default(""),unit:text("unit").notNull().default("份"),cost:real("cost"),
 quantity:integer("quantity"),countAt:integer("count_at"),location:text("location").notNull().default(""),minimum:integer("minimum").notNull().default(10),
 note:text("note").notNull().default(""),source:text("source").notNull().default("手动新增"),updatedAt:integer("updated_at").notNull(),
 erpCode:text("erp_code").notNull().default(""),size:text("size").notNull().default(""),material:text("material").notNull().default(""),
 stockMode:text("stock_mode").notNull().default("direct"),recipeAt:integer("recipe_at"),ignoreWarning:integer("ignore_warning").notNull().default(0),
 trackingEnabled:integer("tracking_enabled").notNull().default(1),trackingAt:integer("tracking_at"),packingCost:real("packing_cost").notNull().default(0),
},t=>[primaryKey({columns:[t.scope,t.code]})]);
export const orders = sqliteTable("orders", {
 scope:text("scope").notNull(),key:text("key").notNull(),orderId:text("order_id").notNull(),shop:text("shop").notNull(),platform:text("platform").notNull(),
 code:text("code").notNull(),title:text("title").notNull(),spec:text("spec").notNull(),quantity:integer("quantity").notNull(),status:text("status").notNull(),orderTime:integer("order_time").notNull(),
 buyerRemark:text("buyer_remark").notNull().default(""),sellerRemark:text("seller_remark").notNull().default(""),remarksAvailable:integer("remarks_available").notNull().default(0),
 shippedAt:integer("shipped_at"),sourceUpdatedAt:integer("source_updated_at"),shippedQty:integer("shipped_qty").notNull().default(0),unitCostSnapshot:real("unit_cost_snapshot"),cutoffAckAt:integer("cutoff_ack_at"),
 amount:real("amount"),cost:real("cost"),deductedQty:integer("deducted_qty").notNull().default(0),review:integer("review").notNull().default(0),reset:integer("reset").notNull().default(0),batchId:text("batch_id").notNull(),updatedAt:integer("updated_at").notNull(),
},t=>[primaryKey({columns:[t.scope,t.key]}),index("orders_by_product").on(t.scope,t.code),index("orders_by_date").on(t.scope,t.orderTime)]);
export const movements=sqliteTable("movements",{
 scope:text("scope").notNull(),id:text("id").notNull(),code:text("code").notNull(),type:text("type").notNull(),delta:integer("delta").notNull(),note:text("note").notNull(),at:integer("at").notNull(),reference:text("reference").notNull().default(""),effectiveAt:integer("effective_at"),kind:text("kind").notNull().default("product"),unit:text("unit").notNull().default(""),
},t=>[primaryKey({columns:[t.scope,t.id]}),index("movements_by_date").on(t.scope,t.at)]);
export const batches=sqliteTable("batches",{
 scope:text("scope").notNull(),id:text("id").notNull(),filename:text("filename").notNull(),createdAt:integer("created_at").notNull(),total:integer("total").notNull().default(0),valid:integer("valid").notNull().default(0),complete:integer("complete").notNull().default(0),
 testMode:integer("test_mode").notNull().default(0),
},t=>[primaryKey({columns:[t.scope,t.id]})]);
export const warehouseSettings=sqliteTable("warehouse_settings",{
 scope:text("scope").primaryKey().notNull(),importTestMode:integer("import_test_mode").notNull().default(0),activeTestImport:integer("active_test_import").notNull().default(0),updatedAt:integer("updated_at").notNull(),
});
export const receipts=sqliteTable("receipts",{scope:text("scope").notNull(),id:text("id").notNull(),at:integer("at").notNull()},t=>[primaryKey({columns:[t.scope,t.id]})]);
export const physicalStocks=sqliteTable("physical_stocks",{
 scope:text("scope").notNull(),code:text("code").notNull(),name:text("name").notNull(),spec:text("spec").notNull().default(""),
 quantity:integer("quantity"),countAt:integer("count_at"),cost:real("cost"),location:text("location").notNull().default(""),minimum:integer("minimum").notNull().default(10),note:text("note").notNull().default(""),updatedAt:integer("updated_at").notNull(),archived:integer("archived").notNull().default(0),ignoreWarning:integer("ignore_warning").notNull().default(0),unit:text("unit").notNull().default("张"),
},t=>[primaryKey({columns:[t.scope,t.code]})]);
export const stockRules=sqliteTable("stock_rules",{
 scope:text("scope").notNull(),salesCode:text("sales_code").notNull(),stockCode:text("stock_code").notNull(),perUnit:integer("per_unit").notNull(),
},t=>[primaryKey({columns:[t.scope,t.salesCode,t.stockCode]}),index("rules_by_stock").on(t.scope,t.stockCode)]);
export const orderStocks=sqliteTable("order_stocks",{
 scope:text("scope").notNull(),orderKey:text("order_key").notNull(),salesCode:text("sales_code").notNull(),stockCode:text("stock_code").notNull(),deductedQty:integer("deducted_qty").notNull().default(0),reset:integer("reset").notNull().default(0),updatedAt:integer("updated_at").notNull(),
},t=>[primaryKey({columns:[t.scope,t.orderKey,t.stockCode]}),index("deductions_by_stock").on(t.scope,t.stockCode)]);
// Authorizes a fresh recipe after permanent paper deletion without erasing past deductions.
export const retiredRecipes=sqliteTable("retired_recipes",{
 scope:text("scope").notNull(),salesCode:text("sales_code").notNull(),retiredAt:integer("retired_at").notNull(),
},t=>[primaryKey({columns:[t.scope,t.salesCode]})]);

export const orderConflicts=sqliteTable('order_conflicts',{
 scope:text('scope').notNull(),orderKey:text('order_key').notNull(),payload:text('payload').notNull(),reason:text('reason').notNull(),fingerprint:text('fingerprint').notNull(),createdAt:integer('created_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.orderKey]})]);
export const orderReturns=sqliteTable('order_returns',{
 scope:text('scope').notNull(),id:text('id').notNull(),orderKey:text('order_key').notNull(),code:text('code').notNull(),kind:text('kind').notNull(),quantity:integer('quantity').notNull(),damaged:integer('damaged').notNull().default(0),at:integer('at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]}),index('returns_by_order').on(t.scope,t.orderKey,t.kind,t.code)]);

// Configuration is separate from stock quantities and historical order costs.
export const costMaterials=sqliteTable('cost_materials',{
 scope:text('scope').notNull(),id:text('id').notNull(),name:text('name').notNull(),gsm:real('gsm').notNull(),weightKgM2:real('weight_kg_m2'),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]})]);
export const freightTemplates=sqliteTable('freight_templates',{
 scope:text('scope').notNull(),id:text('id').notNull(),payload:text('payload').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]})]);
export const inventoryWeights=sqliteTable('inventory_weights',{
 scope:text('scope').notNull(),kind:text('kind').notNull(),code:text('code').notNull(),payload:text('payload').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.kind,t.code]})]);
export const analyticsSettings=sqliteTable('analytics_settings',{
 scope:text('scope').primaryKey().notNull(),payload:text('payload').notNull(),updatedAt:integer('updated_at').notNull(),
});
export const productLifecycle=sqliteTable('product_lifecycle',{
 scope:text('scope').notNull(),code:text('code').notNull(),payload:text('payload').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.code]})]);

export const digitStockVariants=sqliteTable('digit_stock_variants',{
 scope:text('scope').notNull(),baseCode:text('base_code').notNull(),color:text('color').notNull(),stockCode:text('stock_code').notNull(),size:integer('size').notNull(),start:integer('start').notNull(),end:integer('end').notNull(),availableEnd:integer('available_end').notNull(),
},t=>[primaryKey({columns:[t.scope,t.baseCode,t.color]}),index('digit_variant_stock').on(t.scope,t.stockCode)]);
export const digitFulfillments=sqliteTable('digit_fulfillments',{
 scope:text('scope').notNull(),orderKey:text('order_key').notNull(),status:text('status').notNull(),color:text('color').notNull(),reason:text('reason').notNull(),signature:text('signature').notNull(),ignoreCutoff:integer('ignore_cutoff').notNull().default(0),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.orderKey]})]);
export const digitFulfillmentRules=sqliteTable('digit_fulfillment_rules',{
 scope:text('scope').notNull(),orderKey:text('order_key').notNull(),salesCode:text('sales_code').notNull(),stockCode:text('stock_code').notNull(),perUnit:integer('per_unit').notNull(),allocatedQty:integer('allocated_qty'),
},t=>[primaryKey({columns:[t.scope,t.orderKey,t.stockCode]})]);

export const orderFinance=sqliteTable('order_finance',{
 scope:text('scope').notNull(),orderKey:text('order_key').notNull(),refundAmount:real('refund_amount'),netAmount:real('net_amount'),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.orderKey]})]);
export const orderWaybills=sqliteTable('order_waybills',{
 scope:text('scope').notNull(),orderKey:text('order_key').notNull(),tracking:text('tracking').notNull(),carrier:text('carrier').notNull().default(''),
},t=>[primaryKey({columns:[t.scope,t.orderKey,t.tracking]}),index('waybills_by_tracking').on(t.scope,t.tracking)]);
export const freightBills=sqliteTable('freight_bills',{
 scope:text('scope').notNull(),tracking:text('tracking').notNull(),month:text('month').notNull(),carrier:text('carrier').notNull().default(''),feeCents:integer('fee_cents').notNull(),filename:text('filename').notNull(),batchId:text('batch_id').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.tracking]}),index('freight_by_month').on(t.scope,t.month)]);
export const freightPeriods=sqliteTable('freight_periods',{
 scope:text('scope').notNull(),month:text('month').notNull(),packingCents:integer('packing_cents'),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.month]})]);
export const freightImports=sqliteTable('freight_imports',{
 scope:text('scope').notNull(),id:text('id').notNull(),month:text('month').notNull(),filename:text('filename').notNull(),total:integer('total').notNull(),skipped:integer('skipped').notNull(),processed:integer('processed').notNull().default(0),complete:integer('complete').notNull().default(0),createdAt:integer('created_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]})]);
export const printCatalog=sqliteTable('print_catalog',{
 perPack:integer('per_pack'),perSheet:integer('per_sheet'),sheetCost:real('sheet_cost'),sheetWeightG:real('sheet_weight_g'),layoutMode:text('layout_mode').notNull().default('single'),
 scope:text('scope').notNull(),code:text('code').notNull(),name:text('name').notNull(),spec:text('spec').notNull().default(''),material:text('material').notNull().default(''),unit:text('unit').notNull().default('份'),note:text('note').notNull().default(''),enabled:integer('enabled').notNull().default(1),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.code]})]);
export const printJobs=sqliteTable('print_jobs',{
 accountingMode:text('accounting_mode').notNull().default('whole'),memberKeys:text('member_keys').notNull().default('[]'),
 actualWeightG:real('actual_weight_g'),estimateSnapshot:text('estimate_snapshot'),
 scope:text('scope').notNull(),shop:text('shop').notNull(),orderId:text('order_id').notNull(),note:text('note').notNull(),status:text('status').notNull().default('queued'),actualQuantity:integer('actual_quantity'),unit:text('unit').notNull().default('张'),costCents:integer('cost_cents'),completedAt:integer('completed_at'),basis:text('basis').notNull(),needsReview:integer('needs_review').notNull().default(0),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.shop,t.orderId]})]);
export const printEvents=sqliteTable('print_events',{
 scope:text('scope').notNull(),id:text('id').notNull(),shop:text('shop').notNull(),orderId:text('order_id').notNull(),action:text('action').notNull(),note:text('note').notNull(),at:integer('at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]})]);
export const packingSettings=sqliteTable('packing_settings',{
 scope:text('scope').primaryKey().notNull(),feeCents:integer('fee_cents'),updatedAt:integer('updated_at').notNull(),
});
export const printStockCorrections=sqliteTable('print_stock_corrections',{
 scope:text('scope').notNull(),id:text('id').notNull(),kind:text('kind').notNull(),code:text('code').notNull(),quantity:integer('quantity').notNull(),shipmentAt:integer('shipment_at').notNull(),returnedAt:integer('returned_at').notNull(),shop:text('shop').notNull(),orderId:text('order_id').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]}),index('print_corrections_by_stock').on(t.scope,t.kind,t.code,t.shipmentAt,t.returnedAt)]);

export const printPaperSettings=sqliteTable('print_paper_settings',{scope:text('scope').primaryKey().notNull(),sheetCost:real('sheet_cost'),sheetWeightG:real('sheet_weight_g'),updatedAt:integer('updated_at').notNull()});
export const printSizeRules=sqliteTable('print_size_rules',{
 scope:text('scope').notNull(),sizeCm:real('size_cm').notNull(),perSheet:integer('per_sheet').notNull(),sheetCost:real('sheet_cost'),sheetWeightG:real('sheet_weight_g'),enabled:integer('enabled').notNull().default(1),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.sizeCm]})]);

export const namedPrintRules=sqliteTable('print_rules',{
 scope:text('scope').notNull(),id:text('id').notNull(),name:text('name').notNull(),material:text('material').notNull(),perSheet:integer('per_sheet'),sheetWeightG:real('sheet_weight_g'),printCost:real('print_cost'),laminated:integer('laminated').notNull().default(0),laminationCost:real('lamination_cost'),cutting:text('cutting').notNull().default('none'),flatCutCost:real('flat_cut_cost'),dieCutCost:real('die_cut_cost'),enabled:integer('enabled').notNull().default(1),note:text('note').notNull().default(''),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]})]);
export const printRuleLinks=sqliteTable('print_rule_links',{scope:text('scope').notNull(),code:text('code').notNull(),ruleId:text('rule_id').notNull(),perPackOverride:integer('per_pack_override'),updatedAt:integer('updated_at').notNull()},t=>[primaryKey({columns:[t.scope,t.code]})]);
export const printRuleMatches=sqliteTable('print_rule_matches',{scope:text('scope').notNull(),shop:text('shop').notNull(),orderId:text('order_id').notNull(),code:text('code').notNull(),ruleId:text('rule_id').notNull(),perPackOverride:integer('per_pack_override'),updatedAt:integer('updated_at').notNull()},t=>[primaryKey({columns:[t.scope,t.shop,t.orderId,t.code]})]);

export const productSupplyProfiles=sqliteTable("product_supply_profiles",{scope:text("scope").notNull(),code:text("code").notNull(),sourceProduct:text("source_product").notNull(),sourceRevision:integer("source_revision").notNull(),config:text("config").notNull(),updatedAt:integer("updated_at").notNull()},t=>[primaryKey({columns:[t.scope,t.code]})]);

export const purchaseOrders=sqliteTable('purchase_orders',{
 scope:text('scope').notNull(),id:text('id').notNull(),kind:text('kind').notNull(),code:text('code').notNull(),name:text('name').notNull(),spec:text('spec').notNull(),unit:text('unit').notNull(),quantity:integer('quantity').notNull(),amountCents:integer('amount_cents').notNull(),supplier:text('supplier').notNull().default(''),note:text('note').notNull().default(''),status:text('status').notNull().default('pending'),createdAt:integer('created_at').notNull(),receivedAt:integer('received_at'),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]}),index('purchases_by_date').on(t.scope,t.createdAt)]);
export const purchaseDefaults=sqliteTable('purchase_defaults',{
 scope:text('scope').notNull(),kind:text('kind').notNull(),code:text('code').notNull(),supplier:text('supplier').notNull(),unit:text('unit').notNull(),unitPrice:real('unit_price').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.kind,t.code]})]);

export const digitRemarkRules=sqliteTable('digit_remark_rules',{scope:text('scope').notNull(),id:text('id').notNull(),payload:text('payload').notNull(),updatedAt:integer('updated_at').notNull()},t=>[primaryKey({columns:[t.scope,t.id]})]);

export const inventoryEntries=sqliteTable('inventory_entries',{
 scope:text('scope').notNull(),id:text('id').notNull(),type:text('type').notNull(),orderKey:text('order_key').notNull().default(''),reference:text('reference').notNull().default(''),items:text('items').notNull(),note:text('note').notNull(),operator:text('operator').notNull(),receivedAt:integer('received_at').notNull(),createdAt:integer('created_at').notNull(),
},t=>[primaryKey({columns:[t.scope,t.id]}),index('inventory_entries_recent').on(t.scope,t.createdAt)]);
