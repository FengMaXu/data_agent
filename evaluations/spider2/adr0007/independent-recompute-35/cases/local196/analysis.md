# local196：独立重算与事后字段审查

**结论：独立与原均按真实rental数减1；Gold五组后续租赁均值精确等于payment记录数减1，其中5条payment.rental_id为NULL。Gold把无租赁关联付款当租赁，局部计数冲突已实证。**

### 原题（逐字）

> For each rating category of the first movie rented by customers—where the first movie is identified based on the earliest payment date per customer—please provide the average total amount spent per customer and the average number of subsequent rentals (calculated as the total number of rentals minus one) for customers whose first rented movie falls into that rating category.

## 独立题解及结果
先按客户独立SUM付款总额，再COUNT DISTINCT rental_id−1，首片取最早payment_date对应影片rating，最后每客户等权平均。真实599客户的首付款全部无并列，故payment_id次序不影响答案。payment16049记录，rental16044事件，有5个客户payment数比租赁数多1；付款所覆盖的非空rental身份与真实rental数一致。
独立5组均值与原SQL重算相同，仅原SQL最后舍入。真实后续租赁均值G25.2980769231、NC-17 25.3589743590、PG26.2641509434、PG-13 26.3809523810、R25.48，花费均值也全部一致。
## Gold失分的实际机制
Gold的后续次数为G25.32、NC-17 25.37、PG26.27、PG-13 26.38、R25.49。只把真实rental数改成payment行数，再减1，就分别得到25.3173076923、25.3675213675、26.2735849057、26.3809523810、25.488，舍入后五组全部精确重现Gold。
实查多出的不是同一租赁多付款，而是payment_id424/7011/10840/14675/15458的rental_id为NULL，客户16/259/401/546/577。它们是付款事件，不是题面“total number of rentals”。支付总额仍应包括它们，不应为了租赁数去删消费总额。当前Gold局部混淆事件实体；未知它原始SQL是否真的COUNT(payment)，重建只是充分的数值机制。
## 最后审查原Spec
原custom公式明确Metric2是“total number of rentals ... −1”，countGrain为客户等权；原SQLCOUNT(*) FROM rental，实际rental_id唯一16044，所以实现正确。原joinMultiplicity甚至记录5条payment NULL rental_id，证明差异信息当时可见；但没有因此误把它们当租赁。本题不存在原字段未声明的错误；Gold计数单位与题面冲突。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
For each rating category of the first movie rented by customers—where the first movie is identified based on the earliest payment date per customer—please provide the average total amount spent per customer and the average number of subsequent rentals (calculated as the total number of rentals minus one) for customers whose first rented movie falls into that rating category.
```

- `parent-sakila-keys-response.json`，JSON pointer `/details/preview/rows`：

```text
16049
```

- `parent-post-count-payment-variant-response.json`，JSON pointer `/details/preview/rows`：

```text
25.317307692307693
```

- `parent-post-nonrental-payments-response.json`，JSON pointer `/details/preview/rows`：

```text
424
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
"rating","avg_spend","avg_subsequent_rentals_number"
PG-13,115.24,26.38
PG,112.67,26.27
NC-17,111.94,25.37
R,111.42,25.49
G,110.66,25.32

```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local196/attempts/attempt-20261010-154318Z/trace.json`，JSON pointer `/toolCalls/12/result/details/fields/8/value`：

```text
total number of rentals of c - 1
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local196/publications/publication_67e7bc2a-42d0-4c3d-acc7-1d76df9b40ad/`。
- 初次冻结：`cases/local196/independent-freeze.json`。官方独立分：0。

- Gold SQL缺失；只确认本次结果等价于错误付款事件计数，不断言其隐藏代码。
- 此类付款存在不一定是数据缺陷，可是真实无关联收费；不能擅自删除总花费。
