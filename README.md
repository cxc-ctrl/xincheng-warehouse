# 新城仓库管理

本仓库以 2026-11-04 从线上提取的正式代码为基线，包含库存盘点、订单导入与冲突暂存、数字贴发货规则、打印核算、采购、快递账单核验、经营分析及店铺配置。

## 开发与构建

使用 Node.js 22.13 或更高版本。运行 `npm ci` 安装依赖，再运行 `npm run build`。自托管入口为 `.next/standalone/server.js`；部署时还需要将 `public` 及 `.next/static` 放入 standalone 对应目录。数据库路径通过 `WAREHOUSE_DATABASE` 配置。SQL 迁移按 `drizzle/` 的编号顺序执行；升级前备份数据库。

运行时数据库、订单文件、商品图片、登录凭据和销售样本不提交到 Git。内置数字贴目录 `data/digit-colors.ts` 属于源代码，保留跟踪。

## 工作树

`projects/xincheng-warehouse` 是 main 正式基线；`worktrees/xincheng-warehouse-dev` 是 develop 开发工作树。上线从已验证的提交创建独立 release，不在服务器当前运行目录中修改或构建。

数据库和库存不在本次整理中修改。历史本地代码及未提交修改保存在 `archive/warehouse-product-20261104/`。
