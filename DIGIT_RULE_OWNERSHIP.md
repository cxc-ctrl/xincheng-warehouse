

2026-10-19 数字贴规则归仓库维护：
产品中心打印规则页仅展示材质加工方案，保留旧 print_rules/digit_conditions 历史记录。数字贴制作方式仅作标记，同步使用 digit_rules_owner=warehouse；不再发送数字条件、数字贴版面关联或要求打印布局。仓库新增“打印定制 → 数字贴条件”，按颜色及尺寸维护范围、超范围/库存不足处理和可选转打印规则。未显式配置时读取原 digit_stock_variants 的备货范围；停用规则保留记录并转人工核对。修改条件不重算原订单扣减与成本，重新同步产品也不覆盖仓库条件。
新增数据库表 warehouse_digit_conditions，原有业务表逐表校验无变化。首次仓库备份：/opt/warehouse-manager/backups/warehouse-digit-ownership-20261019T044420Z-before；产品中心备份：/opt/product-center/deployment-backups/20261019T044747Z-digit-ownership-1.9.4-before。隔离检查包含数字贴多颜色分配、同步幂等、规则归属、超范围/短缺、停用、并发修改与历史数据保留。
仓库最终版本：/opt/warehouse-manager/releases/warehouse-digit-ownership-20261019T045328Z；保存条件使用局部刷新，保留列表、筛选和当前所在页面。最终备份：/opt/warehouse-manager/backups/warehouse-digit-ownership-20261019T045328Z-before。
