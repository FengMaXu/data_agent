# Knowledge Catalog 与检索工具修复设计

> **版本**：v0.1  
> **日期**：2026-09-17  
> **状态**：修复方案，尚未实施  
> **目标**：修复 `search_knowledge` 只返回定位信息、`read_knowledge` 以 80 行硬限制迫使 Agent 分片读取全文的问题；参考 Skill 的暴露方式，让 Agent 先基于知识文档名称和描述选择信息源，再由工具直接返回完成当前判断所需的有界内容。

---

## 1. 结论

本次修复采用以下设计：

1. 每份知识文档增加稳定标识符、名称和描述，组成 Host 生成的 **Knowledge Catalog**。
2. Runtime 在系统提示词中只注入 Knowledge Catalog，不注入文档正文。
3. 保留 `search_knowledge` 与 `read_knowledge` 两个模型工具，但重新划分职责：
   - `search_knowledge` 根据问题检索相关章节，并直接返回有界正文；
   - `read_knowledge` 用于读取已知文档全文或展开指定章节，不再让模型计算行号分页。
4. 少于 500 行的文档允许全文读取；500 行及以上的文档禁止通过模型工具一次性读取全文，只返回目录并要求按章节读取或搜索。
5. 删除模型侧“每次最多 80 行，超出即报错”的机制。内容限制由工具内部安全截断和结构化续读承担，不把分页计算交给模型。
6. 系统提示词改为“先根据目录选择文档，搜索结果足够时直接使用；只有缺少上下文时才展开”，不再强制每次 Search 后继续 Read。
7. 主 Agent 与 delegated explorer 仍各自注册这两个普通工具，但复用现有 `KnowledgeIndex` 和少量无状态辅助函数，确保输出格式和读取限制一致；不新增 Knowledge Retrieval 模块。

本方案不引入 Session 级授权账本，也不尝试用复杂跨调用状态证明“必须先 Search 才能 Read”。它解决的是知识暴露和检索编排问题，不扩张为权限系统。

---

## 2. 问题与证据

在 `spider2-gold49-deepseek-flash-rerun-001/cases/local007` 中：

| 指标 | 实际结果 |
|---|---:|
| 总工具调用 | 50 |
| `search_knowledge` | 11 |
| `read_knowledge` | 22 |
| 超过 80 行而失败的读取 | 3 |
| 进入 `query_database` 前的知识调用 | 33 |
| 任务耗时 | 312219 ms |
| 最终状态 | `max_turns` |
| Result Query | 未执行 |
| CSV | 未生成 |

原设计希望阻止一次性读取全文，但实际把全文读取改造成了多次机械分页：

```text
全文读取意图
  → 80 行范围被拒绝
  → 模型计算拆分点
  → 连续读取多个范围
  → 仍然覆盖接近完整文档
```

因此，80 行限制只限制了单次调用形式，没有约束总读取意图；同时 Search 丢弃已有 snippet，迫使模型为每个命中追加 Read。两者共同增加了工具调用、推理轮次和错误恢复成本。

---

## 3. 设计原则

### 3.1 知识源先可发现，再按需展开

参考 Skill 的暴露方式，Agent 在系统提示词中先看到知识源的稳定标识、名称和用途描述。Agent 应先判断“哪份文档适用”，而不是盲搜文件路径或遍历全部文档。

### 3.2 Search 返回答案材料，不只返回指针

Search 的调用意图是“给我与问题相关的信息”。因此 Search 必须返回相关章节的有界正文，使 Agent 能在一次调用后判断信息是否充分。

### 3.3 模型表达信息意图，工具处理机械取数

模型不负责：

- 计算行号窗口；
- 将 94 行拆成两个范围；
- 根据 80 行限制反复重试；
- 推断下一页从第几行开始。

行号仍由 Runtime 返回，用于定位、引用和审计，但不作为模型读取内容的主要控制接口。

### 3.4 小文档可全文读取，大文档按章节读取

全文读取并非一律错误。对于短规则文档，全文读取可能比多次搜索更简单、更便宜。文档规模政策为：

- `lineCount < 500`：允许全文读取；
- `lineCount >= 500`：不允许一次性全文读取，返回章节目录并要求检索或展开章节。

“少于 500 行”按严格小于判断；499 行允许，500 行不允许。

### 3.5 传输安全与业务读取政策分离

500 行是模型知识读取政策，不替代基础传输安全限制。Runtime 仍保留 Host-owned 最大响应字节数，以防单行异常巨大；该限制不得表现为要求模型自己计算分页。达到传输上限时，工具返回结构化截断状态和不透明续读游标。

### 3.6 知识内容不自动获得业务权威

Knowledge Catalog 只改善发现与读取。文档内容是否属于 reviewed definition、task document、schema fact 或普通学习记录，仍由 Evidence Authority 和未来的 Host-owned Evidence Registry 决定。工具返回内容不能因为可检索就自动升级为业务事实。

---

## 4. 知识文档元数据

### 4.1 Frontmatter 格式

每份知识文档在文件头增加 YAML frontmatter：

```yaml
---
knowledgeId: semantic-guide
name: 数据分析语义理解指引
description: 用于拆解查询问题、填写七槽位，并按专题处理总体、聚合、时间、排名、事件序列和状态歧义。
---
```

字段定义：

| 字段 | 必填 | 约束 | 用途 |
|---|---|---|---|
| `knowledgeId` | 是 | 全局唯一；稳定；`[a-z][a-z0-9-]{1,63}` | 模型工具和审计记录使用的知识源标识 |
| `name` | 是 | 非空、面向 Agent 可读 | 系统提示词中的知识源名称 |
| `description` | 是 | 一至两句，说明何时使用和不负责什么 | Agent 路由知识源的主要依据 |

物理路径不是模型选择知识源的稳定身份。路径可以改变，`knowledgeId` 在文档语义职责不变时保持不变。

### 4.2 初始 Knowledge Catalog

当前文档建议使用以下元数据：

| knowledgeId | name | description |
|---|---|---|
| `semantic-guide` | 数据分析语义理解指引 | 用于拆解问题、建立七槽位，并按专题处理总体、连接权重、多级聚合、时间、排名、事件序列和状态歧义；不提供具体业务枚举。 |
| `sql-rules` | SQL 生成规范 | 用于把当前 Answer Spec 实现为安全、符合目标方言的 SQL，包括聚合、精度、NULL 和方言规则；不负责决定业务口径。 |
| `business-definitions` | 业务定义 | 提供当前任务或业务域的指标、枚举、阈值和已知业务约束；内容为空时不得用通用经验补造定义。 |
| `database-schema` | 数据库结构 | 提供表、列、类型及正式结构信息，用于物理映射；字段存在不自动证明业务含义。 |
| `query-patterns` | 已验证查询模式 | 提供可复用的查询结构和适用前提；模式只能在前提匹配时复用。 |
| `learning-notes` | 历史纠错与经验 | 提供历史错误、方言陷阱和可复用经验；其证据等级低于用户、业务定义和正式 Schema。 |

### 4.3 加载与校验

Knowledge Catalog 在知识库加载时生成。加载规则：

1. 缺少任一必填字段：该文档不进入模型可见目录，并产生启动诊断；
2. `knowledgeId` 重复：知识库加载失败，禁止静默选择其中一份；
3. 标识符格式非法：知识库加载失败；
4. 名称或描述为空：知识库加载失败；
5. 文档更新后，索引中的 revision、章节和内容 Hash 同步更新；
6. Spider2 每题生成或复制的 `business.md`、`db_schema.md` 等文档也必须带有同样元数据，不能仅修改仓库静态模板。

Frontmatter 不进入正文搜索结果，不计入章节正文；文档行数政策是否包含 frontmatter 必须统一。本方案定义 `lineCount` 为物理文件总行数，包含 frontmatter，避免同一文件出现两种计数。

---

## 5. 系统提示词注入

### 5.1 动态目录

Runtime 在基础系统提示词之后注入由 Host 生成的目录：

```text
<knowledge_catalog>
- id: semantic-guide
  name: 数据分析语义理解指引
  description: 用于拆解问题、建立七槽位，并按专题处理总体、聚合、时间、排名、事件序列和状态歧义；不提供具体业务枚举。
- id: sql-rules
  name: SQL 生成规范
  description: 用于把当前 Answer Spec 实现为安全、符合目标方言的 SQL；不负责决定业务口径。
- id: database-schema
  name: 数据库结构
  description: 提供表、列、类型及正式结构信息；字段存在不自动证明业务含义。
</knowledge_catalog>
```

注入内容只包含：

- `knowledgeId`；
- 名称；
- 描述。

不注入路径、正文、全文行数或搜索索引内部信息。物理路径由 Runtime 管理。

### 5.2 基础行为指令

系统提示词中的知识读取规则调整为：

```text
根据 Knowledge Catalog 选择当前问题需要的知识源，遵循按需加载：
- 优先调用 search_knowledge 获取相关章节及其正文；搜索结果已经足够时直接使用，不要为了完成形式流程再次读取。
- 只有搜索正文缺少必要上下文时，才调用 read_knowledge 展开指定章节。
- 少于 500 行的短文档可以按需全文读取；不得因为允许全文读取就无差别加载所有短文档。
- 500 行及以上文档不得请求全文，使用搜索或章节读取。
- 不重复请求当前上下文已经包含的相同章节。
```

删除以下强制关系：

```text
先 search_knowledge，然后必须 read_knowledge
```

“编写 SQL 前阅读规则”改为“获取与当前 SQL 特征和方言相关的规则”。不要求每次读取整个 `sql-rules`。

---

## 6. 工具 Interface

### 6.1 保留两个工具

保留工具名以减少协议迁移范围：

- `search_knowledge`
- `read_knowledge`

它们仍是两个普通工具，不新增 Knowledge Retrieval 模块或新的业务 Interface。实现直接复用现有 `KnowledgeIndex`、`readBoundedFile` 以及少量无状态的元数据解析、结果格式化和读取政策函数。主 Agent 与 delegated explorer 分别注册工具；delegated explorer 继续使用现有授权文档集合过滤结果。

### 6.2 `search_knowledge`

#### 输入

```ts
interface SearchKnowledgeInput {
  query: string;
  knowledgeIds?: string[];
  maxResults?: number;
}
```

规则：

- `query` 表达所需信息，而不是文件路径；
- `knowledgeIds` 可根据系统提示词中的目录限定知识源；
- `maxResults` 是期望值，由 Host 限制在安全范围内；默认 5，最大 8；
- Host 对整个响应设置总字节或 Token 预算，模型不能扩大 Host 上限。

#### 输出

```ts
interface KnowledgeSearchResult {
  hits: Array<{
    knowledgeId: string;
    name: string;
    sectionId: string;
    sectionTitle: string;
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    content: string;
    truncated: boolean;
    contentRef: string;
  }>;
  omittedHitCount: number;
}
```

关键要求：

1. `content` 必须包含实际相关正文，禁止只返回路径和行号；
2. 响应先按相关度选择 Hit，再在全局响应预算内分配正文；
3. 每个 Hit 保留路径和行号，用于引用和审计；
4. `sectionId` 是索引生成的稳定章节定位，不要求模型计算行号；
5. `contentRef` 绑定文档 revision、章节和实际返回内容，用于去重观测和未来 Evidence Registry 接入；它本身不授予业务权威；
6. `truncated=true` 时提示可用 `read_knowledge` 展开该 `sectionId`；
7. 不默认返回“相关但未展开”的大列表，避免诱导模型继续遍历。只有正文被预算截断时返回少量未展开计数。

### 6.3 `read_knowledge`

#### 输入

```ts
interface ReadKnowledgeInput {
  knowledgeId: string;
  sectionId?: string;
  continuationToken?: string;
}
```

三种行为：

#### A. 短文档全文读取

调用：

```json
{ "knowledgeId": "sql-rules" }
```

当 `lineCount < 500` 时返回全文：

```ts
{
  mode: "full_document",
  knowledgeId: string,
  name: string,
  content: string,
  lineCount: number,
  contentRef: string
}
```

#### B. 大文档全文请求

当 `lineCount >= 500` 且没有 `sectionId` 时，不抛普通工具错误，也不返回正文，返回结构化导航：

```ts
{
  mode: "section_required",
  knowledgeId: string,
  name: string,
  lineCount: number,
  sections: Array<{
    sectionId: string,
    title: string,
    startLine: number,
    endLine: number
  }>,
  message: "该文档不少于 500 行，请使用 search_knowledge 或指定 sectionId。"
}
```

这避免 `TOO_LARGE` 错误触发昂贵的模型错误恢复。

#### C. 章节读取

调用：

```json
{
  "knowledgeId": "database-schema",
  "sectionId": "table-player"
}
```

返回指定章节正文：

```ts
{
  mode: "section",
  knowledgeId: string,
  sectionId: string,
  sectionTitle: string,
  content: string,
  startLine: number,
  endLine: number,
  truncated: boolean,
  continuationToken?: string,
  contentRef: string
}
```

章节超过 Host 响应预算时：

- 工具内部按完整 UTF-8 和完整行截断；
- 返回不透明 `continuationToken`；
- 模型只表达“继续当前章节”，不计算下一段行号；
- token 与文档 revision 和章节绑定，文档变化后失效。

### 6.4 移除模型行号参数

模型可见的 `read_knowledge` 不再接受：

```ts
startLine?: number;
endLine?: number;
```

行号仍存在于返回结果和内部文件读取实现中。产品内部协议若有非模型调用者依赖范围读取，可以保留原有内部命令，但不能继续作为模型工具 Interface 暴露。

---

## 7. 文档分段与 Schema 特例

### 7.1 通用 Markdown

按标题建立章节树：

- 一级标题提供文档名称；
- 二级及以下标题形成可读取章节；
- `sectionId` 从 `knowledgeId + heading path` 稳定派生；
- 标题重名时加入父标题或稳定序号消歧。

### 7.2 Schema 文档

对于 `database-schema`：

- 每个 `## Table: <name>` 是独立章节；
- Search 命中表名、列名或定义时，直接返回完整表定义，前提是全局响应预算允许；
- Agent 查询 `player debut final_game` 应一次获得 `player` 表定义，不需要读取整个 Schema；
- 表关系只有在 Schema 正式声明或业务文档明确说明时才作为关系证据；不能因为相同列名自动推断业务关系。

### 7.3 无标题文档

无标题文档在索引时按有界段落生成内部章节。工具返回稳定 `sectionId`，不把段落窗口计算暴露给模型。

---

## 8. 重复读取策略

本阶段不建设复杂 Session Ledger，也不以重复请求为硬错误。

采用以下轻量策略：

1. 每个返回块携带稳定 `contentRef`；
2. 系统提示词要求不要重复请求当前上下文已有的 `contentRef`；
3. Trace 记录重复 `contentRef` 次数，作为评测指标；
4. 完全相同的工具输入可以利用现有 replay/idempotency 机制返回相同结果；
5. 只有后续评测仍证明重复读取是主要问题时，再设计 operation-scoped 去重；不得预先引入跨 Session 授权账本。

这种策略避免因上下文压缩、分支切换或子 Agent 隔离而错误拒绝一次实际必要的重读。

---

## 9. 主 Agent 与 delegated explorer

不新增 Knowledge Retrieval 模块。现有两处工具注册保持不变：

- 主 Agent 在 `tools/core.ts` 注册 `search_knowledge` 和 `read_knowledge`；
- delegated explorer 在 `application/delegation.ts` 注册同名受限工具。

两处直接使用现有 `KnowledgeIndex` 和文件读取能力。为避免规则漂移，只抽取以下无状态辅助函数或类型：

- frontmatter 解析与元数据校验；
- `knowledgeId` 到物理路径的查询；
- Search Hit 的统一输出格式化；
- `< 500` 行全文读取判断；
- 章节定位、响应截断和 continuation token 编解码；
- revision 与 `contentRef` 生成。

这些辅助函数不组成新的业务 Interface，不持有会话状态，不接管工具调用，也不增加新的依赖注入层。主 Agent 读取完整目录；delegated explorer 在调用现有 `KnowledgeIndex.search` 和读取函数前继续应用 Host 已提供的授权文档过滤条件。

验收重点是两个普通工具对相同输入产生一致的内容格式和规模政策，而不是要求它们经由新的对象或模块转发。

---

## 10. 实施任务

### P0：回滚已确认的负优化

- [ ] `search_knowledge` 恢复返回有界正文，不再丢弃索引中的 snippet。
- [ ] 移除模型工具的 80 行硬拒绝和相应提示词。
- [ ] 删除“Search 后必须 Read”的系统提示词表达。
- [ ] 保留本轮与知识读取无关的修复：Answer Spec 精确 Schema、探索 Evidence ID 可见性、评测预算配置。

### P1：Knowledge Catalog

- [ ] 为六份仓库知识文档添加 `knowledgeId/name/description` frontmatter。
- [ ] 修改 Spider2 知识文档生成与复制逻辑，为每题文档保留或补充元数据。
- [ ] KnowledgeIndex 加载并校验元数据、唯一 ID、revision 和章节。
- [ ] Runtime 根据 Catalog 动态生成系统提示词目录。
- [ ] 系统提示词改为按需选择、搜索正文足够即停止。

### P2：工具 Interface

- [ ] `search_knowledge` 支持 `knowledgeIds`，返回 Top Hit 正文、章节身份和 `contentRef`。
- [ ] `read_knowledge` 改为 `knowledgeId + sectionId? + continuationToken?`。
- [ ] 实现严格的 `< 500` 行全文读取政策。
- [ ] 对 `>= 500` 行全文请求返回 `section_required`，不作为 Tool Error。
- [ ] 实现章节读取、Host 响应预算和不透明 continuation token。
- [ ] 主 Agent 与 delegated explorer 复用无状态校验和格式化函数，不新增 Knowledge Retrieval 模块。

### P3：观测与评测

- [ ] Trace 记录每次返回的 `knowledgeId/sectionId/contentRef/mode/truncated`。
- [ ] 统计每题 Search、Read、重复 contentRef、知识阶段耗时和首次 SQL 时间。
- [ ] 重跑 `local007`，确认不再遍历整个 Schema。
- [ ] 对代表性小文档、大 Schema、长章节和子 Agent 场景做回归。

---

## 11. 验收标准

### 11.1 元数据与目录

1. 所有模型可见知识文档都有合法且唯一的 `knowledgeId/name/description`。
2. 系统提示词动态包含名称和描述，不包含文档正文。
3. 重复 ID、缺失字段和非法标识符都有确定性诊断。
4. Spider2 每题生成的知识文档同样满足元数据要求。

### 11.2 Search

1. Search 返回相关正文，而不只是路径和行号。
2. 返回结果包含 `knowledgeId`、章节、行号、分数和 `contentRef`。
3. Search 响应受 Host 总预算控制，且不因某个大章节无限膨胀。
4. `player debut final_game` 检索可直接返回 `player` 表定义，无需第二次读取才看到内容。

### 11.3 Read

1. 499 行文档允许全文读取。
2. 500 行文档不允许全文读取，并返回 `section_required`，不产生普通 Tool Error。
3. 模型工具 Schema 不再暴露 `startLine/endLine`。
4. 大文档可以按 `sectionId` 读取。
5. 超大章节使用不透明 continuation token，不要求模型计算行号。
6. 主 Agent 与 delegated explorer 执行相同读取政策。

### 11.4 行为回归

以 `local007` 为定向回归样本：

1. 知识调用不再出现 `KNOWLEDGE_READ_TOO_LARGE`；
2. 不再通过多个章节读取覆盖完整 `db_schema.md`；
3. 在获取 `player` 表、适用语义规则和 SQLite 规则后进入 Answer Spec 与 SQL；
4. Knowledge 阶段调用目标不超过 6 次，其中正常路径预期 2～4 次；
5. 在 `maxTurns=30`、`maxToolCalls=50`、`timeoutMs=300000` 下完成 Result Query 和发布；
6. 最终 SQL 和 CSV 正确性由既有评测器判定，本方案不以调用数下降替代答案正确性。

---

## 12. 非目标

本方案不负责：

- 建立 Host-owned Evidence Registry；
- 判断某份知识文档是否具有 reviewed business definition 权威；
- 强制所有查询先 Search 才能 Read；
- 用会话账本阻止所有重复读取；
- 将全文 Schema 自动注入模型上下文；
- 用向量数据库替换当前检索实现；
- 根据模型自报“已读”授予或拒绝权限。

这些问题可以在获得独立需求和评测证据后设计，不能与本次检索修复捆绑扩张。

---

## 13. 风险与处置

| 风险 | 处置 |
|---|---|
| 所有当前仓库文档都少于 500 行，Agent 仍可能无差别全文读取 | Catalog 描述和提示词强调按需；评测记录全文读取次数；不把“允许”写成“推荐” |
| Spider2 动态 Schema 超过 500 行 | 自动生成表级 section，Search 直接返回相关表定义 |
| Search 正文过多导致上下文膨胀 | Top Hit 数量和整个响应由 Host 总预算限制 |
| Search 正文太短导致频繁 Read | 以完整相关章节优先，在总预算内动态分配，而不是固定三行摘要 |
| continuation 被模型用于逐页遍历大文档 | 仅对单个已选章节续读；不提供整个文档的全文 continuation |
| frontmatter 被当成知识正文 | 解析阶段剥离，搜索和模型内容中不返回 frontmatter |
| ID 与路径发生漂移 | `knowledgeId` 为稳定身份；路径只作为 Host 映射和引用信息 |
| 为复用逻辑而引入不必要抽象 | 仅抽取无状态纯函数或类型；两个工具仍在现有注册位置直接实现 |
