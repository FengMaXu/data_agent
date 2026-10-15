---
knowledgeId: learning-notes
name: 历史纠错与经验
description: 提供历史错误、方言陷阱和可复用经验；证据等级低于用户、业务定义和正式 Schema。
usage: method
---

# Learnings

> 本文档记录在当前数据库上验证过的经验。每条记录必须包含真实场景、失败原因和可验证的修正；禁止写入占位符、无意义的 SQL 或重复记录。通用 SQL 写法见 [SQL 生成规范](./rules.md)，口径判断见[语义理解指引](./semantic_guide.md)。

## 已验证的失败经验

### 生产业务规则（仅适用于对应业务库）

- 多行业整体新增企业的统计，需要区分新纳统、外部转入和行业内部互转；内部互转不能计入多行业整体新增，但可以计入单行业新增。
- 企业、行业和月度快照的关联关系必须以对应数据库 Schema 和业务文档为准。
### delivery_center 库 orders / hubs 为空，依赖订单的配送指标不可计算

- 实测 `delivery_center.orders` = 0 行、`hubs` = 0 行（`COUNT(*)`）；有数据的表仅 deliveries(378,843)、payments(400,834)、stores(951)、channels(40)、drivers(4,824)。
- 全库**只有 orders** 含日期列（8 个 `order_moment_*` datetime）；deliveries / payments / stores / channels / drivers / hubs 均无任何 datetime/date/timestamp 列，故**无法按月分组**。
- deliveries / payments 均不含 store_id / channel_id / hub_id，到门店、渠道、网点的**唯一关联路径是 orders**；实测 deliveries 的 378,843 行**全部**匹配不到 orders。
- `order_delivery_cost`（配送成本）与 `order_delivery_fee`（配送费）只在 orders 表 → 差额不可计算。
- 结论：本库无法回答"按月订单量与送达率""门店/渠道配送表现""配送成本 vs 配送费差额"。不得用 `deliveries.delivery_status` 总体占比替代送达率，也不得用 `payments.payment_fee` 替代配送费。

