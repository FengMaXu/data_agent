# Git 工作流程

本仓库自 2026-09-29 起采用 develop/feature 流程。

## 分支

| 分支 | 用途 | 来源 | 合入 |
| --- | --- | --- | --- |
| `master` | 稳定主线 | — | 只接收来自 `develop` 的合并 |
| `develop` | 集成分支 | `master` | 通过 PR 合入 `master` |
| `类型/任务描述` | 一项具体工作 | `develop` | 通过 PR 合入 `develop` |

- 不直接在 `master` 或 `develop` 上提交。
- 功能 PR 不以 `master` 为目标。

## 分支命名

格式：`类型/任务描述`。

| 类型 | 用于 | 对应提交前缀 |
| --- | --- | --- |
| `feature` | 新功能 | `feat:` |
| `fix` | 缺陷修复 | `fix:` |
| `docs` | 文档、ADR | `docs:` |
| `refactor` | 不改变行为的重构 | `refactor:` |
| `test` | 只增改测试 | `test:` |
| `chore` | 杂项维护（依赖、配置、清理） | `chore:` |
| `build` | 构建与打包 | `build:` |

任务描述使用小写英文单词，以连字符连接，说明做什么而不是怎么做。例如：

- `feature/chartspec-contract`
- `fix/dashboard-skill-contract`
- `docs/accept-adr-0008`

## 日常流程

```bash
# 1. 从最新的 develop 拉分支
git switch develop
git pull --ff-only
git switch -c feature/<任务描述>

# 2. 开发、提交（见“提交信息”），推送
git push -u origin feature/<任务描述>

# 3. 验证通过后开 PR，目标为 develop
gh pr create --base develop

# 4. 评审通过后合并（见“合并”），删除分支
gh pr merge <编号> --merge --delete-branch

# 5. develop 攒够一批后，开 PR 合入 master
gh pr create --base master --head develop
```

一个分支只做一件事。改动涉及互不相关的内容时，拆成多个分支和 PR。

## 提交信息

- 格式：`类型: 简述`。类型取上表的提交前缀，简述用英文祈使句。正文说明为什么改，以及不显而易见的取舍。
- 解决 issue 的提交在正文中写 `Closes #<编号>`。
- 一个提交只做一件事；不相关的本地改动分开提交。
- 不使用 `--no-verify` 跳过 hooks。仓库当前配置了 Git LFS 的 `post-checkout`、`post-commit`、`post-merge`、`pre-push` hook。

## 验证

各个包通过构建产物相互依赖：改动 `packages/contracts` 会影响 runtime 与前端，改动根目录的 `package.json` 或 `package-lock.json` 会影响所有 workspace。所以只跑改动所在的包，不足以证明下游没有受影响。按时机分三档：

| 时机 | 运行 |
| --- | --- |
| 开发过程中 | 改动所在包的测试与类型检查，例如在包目录下运行 `npx vitest run`、`npx tsc -p tsconfig.json --noEmit` |
| 推送、开 PR 之前 | `npm run check:affected`：架构检查，加上改动的 workspace 及其全部下游的类型检查与测试 |
| PR 上 | CI 跑全量，作为合并门槛 |
| 开 PR 从 `develop` 到 `master` 之前 | `npm run verify:backend`：全量，加负向类型测试、分发构建与 web host 冒烟测试 |

`check:affected` 以与 `origin/develop` 的合并基点比较（包括未提交与未跟踪的文件），按各 workspace `package.json` 中的依赖关系向下游展开，只构建所需的上游包。规则：

- `docs/`、根目录 `*.md`、`.github/`、`evaluations/` 不触发检查；`.agents/` 算作 runtime（其测试读取 skill）。
- 根目录的 `package.json`、`package-lock.json`、`scripts/` 及其他不属于任何 workspace 的文件退回全量。
- `--dry-run` 只打印计划；`--all` 强制全量；`--base <ref>` 指定比较基点。

本地不再跑全仓 `npm run typecheck` 与 `npm test`：根脚本的 `pretypecheck`、`pretest` 各自会完整构建一次，而全量已由 CI 覆盖。改动只涉及文档时，`check:affected` 不执行任何检查。

### CI

`.github/workflows/ci.yml` 在所有 PR（包括叠加在其他功能分支上的 PR）、以及对 `develop`、`master` 的推送上自动运行：架构检查、脚本测试、一次完整构建、各 workspace 类型检查、runtime 负向类型测试、各 workspace 测试（Windows runner，Node 22）。

- CI 失败的 PR 不合并。
- 目标为 `master` 的 PR 与对 `master` 的推送上，CI 另外运行分发构建与 web host 冒烟测试；其他 PR 上跳过。Electron 打包冒烟（`verify:backend:packaged`）仍只在本地运行。
- MySQL 契约测试需要 `DATA_AGENT_TEST_MYSQL=1` 和可用的数据库，CI 中跳过，需要时在本地运行。

## 合并

- 合并前确认 CI 通过。
- 使用 merge commit（`gh pr merge --merge`），保留提交历史。
- 合并后删除已合并的分支，本地和远端都要删。
- PR 开出后停在评审阶段，由维护者明确决定是否合并。

## 叠加分支

某项工作依赖另一个尚未合并的分支时：

- 从被依赖的分支拉出，PR 以它为目标；
- 被依赖的 PR 合并后，把这个 PR 的目标改为 `develop`（`gh pr edit <编号> --base develop`）；
- 拉分支前，先确认被依赖分支的本地提交都已推送，避免把无关提交带进 PR。

## 不纳入版本控制

`.gitignore` 已排除以下内容，不要强制添加：

- `.artifacts/`：实验快照与评测记录
- `scratch/`：临时脚本与草稿
- 仓库根目录的 `*.pdf`：参考论文

## 相关文档

- issue 操作：`docs/agents/issue-tracker.md`
- triage 标签：`docs/agents/triage-labels.md`
