# local100：独立重算与事后字段审查

**结论：独立合作图集合计算25698，与原SQL实跑一致；源身份1、直接合作者2382、两步内28081，排除source/一跳得到25698。Gold15911与当前完整图不兼容，隐藏子集或历史数据原因未知。**

### 原题（逐字）

> Find out how many actors have a 'Shahrukh number' of 2? This means they acted in a film with someone who acted with Shahrukh Khan, but not directly with him.

## 独立解题
不构造全体演员两两平方图：查到唯一源PID nm0451321（姓名带前导空格的Shah Rukh Khan），取其90部电影的出演PID集合，得到含源本人2383个一跳可达身份；再取这些演员的3206部电影的全部出演者，集合减去一跳及源，得到25698个最短合作距离恰好2的演员。
所有M_Cast电影MID均有Movie记录；全部二跳PID均可连接Person，二跳集合与一跳交集为0。独立最终25698已发布冻结。
## 三方核对与实际交叉检查
原SQLltrim(PID)逐层DISTINCT、排除直接合作者与源，实际复跑同为25698。集合恒等式：两步以内可达28081 −直接2382 −源1 =25698。不是不同join SQL碰巧同数，而是逐层可达集合与互斥关系均检查。
Gold15911小于当前完整二跳集合。即使尝试按性别/姓名投影，Male身份15833、Female7519、未知2346；按Male Person行得到15909也不等15911，更不能因为接近就为题面添加男性过滤。题面没有性别、年代、已知演员等筛选。
所以现可判为本题明确完整图要求与当前Gold不兼容；不声称已查明Gold具体遗漏哪些身份，因为Gold只给总数、没有人物清单/SQL。可能是历史数据库版本或隐藏资格，不把它写成已证实原因。
## 原字段事后审查
原population.conditions明确“存在...中间演员...同时该演员不曾...直接出演”；entity/countGrain为PID，joinMultiplicity强调逐层DISTINCT；最终SQL实现这些要求。没有找到原字段声明或SQL最短距离实现错误；不是字段树阻止不了错误，而是当前标尺不能支持这个完整图答案。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
Find out how many actors have a 'Shahrukh number' of 2? This means they acted in a film with someone who acted with Shahrukh Khan, but not directly with him.
```

- `parent-hop-counts-response.json`，JSON pointer `/details/preview/rows`：

```text
25698
```

- `parent-post-graph-set-invariants-response.json`，JSON pointer `/details/preview/rows`：

```text
28081
```

- `parent-post-cast-film-integrity-response.json`，JSON pointer `/details/preview/rows`：

```text
3475
```

- `parent-post-gender-projection-response.json`，JSON pointer `/details/preview/rows`：

```text
15833
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
output
15911
```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local100/attempts/attempt-001/trace.json`，JSON pointer `/toolCalls/3/result/details/fields/2/value`：

```text
同时该演员不曾在任何影片中与 Shah Rukh Khan 同片出演
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local100/publications/publication_7f4ba0f1-2ded-4f82-9005-f5e7c69a00e0/`。
- 初次冻结：`cases/local100/independent-freeze.json`。官方独立分：0。

- Gold只给总数，无法给出其具体遗漏人物；机制/数据版本未唯一定位。
- 最短图算法按当前完整cast数据验证，不利用接近Gold的性别过滤来改口径。
