import json
import subprocess
import tempfile
from pathlib import Path

REPO = "FengMaXu/data_agent"
PARENT = "#56 — 实现自由 SQL Query Assurance 的有界确定性门控"

TICKETS = [
    {
        "key": "t1",
        "title": "分离 Candidate 列完整性与 Answer Contract",
        "build": "让空 Hard Output Contract、零行结果和正常查询都能沿 Artifact 到发布路径正确处理，同时仍然拒绝预览与完整 Candidate 之间真实的结果列变化。Candidate 身份完整性与 G1 语义形状从此使用不同裁决依据。",
        "criteria": [
            "Candidate 的预期列只来自对应 Validated Query Artifact 的预览元数据，不再由空 Answer Contract 推导零列。",
            "空或缺失 Hard Output Contract 被解释为语义列约束未知，不产生 `expected []`。",
            "合法零行结果保留列元数据，并可完成内联或 CSV 发布流程。",
            "预览与完整 Candidate 的列名、顺序或行宽真实变化时继续拒绝发布。",
            "Artifact 完整性错误与 Answer Contract 语义错误返回不同、可行动的 violation。",
            "测试覆盖空合同、零行、列变化、额外列以及内联/CSV 两条发布路径。",
        ],
        "blockers": [("ext", 46, "通过 Export Candidate 收集完整结果证据")],
    },
    {
        "key": "t2",
        "title": "用 SQLite 标量查询打通首个有界 G1 门",
        "build": "以 SQLite 标量查询建立第一条完整的有界门控路径：权威 Answer Spec、AST Query Digest、Gate Applicability、G1 判断、Review Outcome、内联/CSV 发布和审计记录全部贯通。",
        "criteria": [
            "SQLite 标量查询的权威 Query Digest 来自固定版本的方言感知 AST parser。",
            "Digest 公开 SQL、Schema、parser、dialect、coverage、unsupported nodes 和 lineage 身份。",
            "Runtime 而非 Solver 决定 G1 是否 checked、not applicable 或 unsupported。",
            "正确的一行一列标量 Candidate 可以继续发布，多行或多列 Candidate 被 G1 拒绝。",
            "属于支持范围但必需 Digest facet 不可用时形成 Review Unavailable，不调用 Reviewer 伪装确定性通过。",
            "tokenizer 或回译结果不能将必需 facet 标记为 checked。",
            "内联与 CSV 通过同一 Query Assurance 行为测试，并记录门版本与结果。",
        ],
        "blockers": [
            ("new", "t1"),
            ("ext", 44, "生成遵循 Evidence Authority 的版本化 Answer Spec"),
            ("ext", 45, "生成多方言 Query Digest 与 Schema Evidence Fingerprint"),
            ("ext", 48, "为 CSV 发布绑定 Review Token 与 Publication Receipt"),
            ("ext", 49, "统一少量内联结果的 Query Assurance 发布"),
        ],
    },
    {
        "key": "t3",
        "title": "完成 G1 最终形状合同门",
        "build": "把首个标量门扩展为完整 G1，使 Top-N、grouped、detail、最终聚合、输出角色、额外列、排序和边界并列都在实际发布 Candidate 上得到一致检查。",
        "criteria": [
            "Answer Contract 支持 scalar、top_n、grouped 和 detail，并使用明确的行数约束。",
            "最终聚合未完成、必需列缺失或存在未授权诊断列时拒绝发布。",
            "未明确要求的展示 alias、类型或顺序不会被模型自动升级为 Hard Constraint。",
            "完整 output lineage 用于匹配业务输出角色，alias 本身不能替代 lineage。",
            "Top-N 同时检查排名、LIMIT、候选数量和 tie policy；边界并列未解决时进入澄清或弃权。",
            "G1 分别使用 Digest、预览元数据和完整 Candidate 元数据完成静态、预览和最终检查。",
            "正确反例与漏最终聚合、多余列、错误 Top-N 等变异均通过公开 Query Assurance seam 测试。",
        ],
        "blockers": [("new", "t2")],
    },
    {
        "key": "t4",
        "title": "阻断有确定性证据的未授权总体缩减",
        "build": "实现有界 G2 总体影响授权门，使明确无授权的过滤或主体丢失在发布前被拒绝，同时允许权威业务过滤及其受控物理编码映射。",
        "criteria": [
            "首版支持范围内的总体影响节点由 Query Digest 结构化表示，并绑定 AST/Digest 路径。",
            "可信控制面为节点计算 authorized、structural、disputed 或 unresolved，忽略 Solver 自报分类。",
            "authorized 必须同时绑定业务 Hard Constraint 和合格的 Physical Mapping Evidence。",
            "Schema 或 observed data 可以证明物理字段和值，但不能反向授权新增业务概念。",
            "disputed 节点被拒绝；unresolved 节点进入 Needs Clarification 或 Abstained，不能 Approved。",
            "明确结构谓词不会被误判为业务过滤；会丢弃主体的 INNER JOIN 在支持范围内接受总体影响检查。",
            "历史无依据排除样本被命中，合法授权过滤和邻近正确反例保持可发布。",
        ],
        "blockers": [("new", "t2")],
    },
    {
        "key": "t5",
        "title": "绑定失败 Candidate、一次修复与实质变化",
        "build": "让 G1/G2 的反证真正约束候选：失败 Candidate 在相同 Spec 和证据版本下永久失去发布资格，Agent 只得到一次针对失败 claim 的实质修复机会。",
        "criteria": [
            "每个阻断 violation 具有稳定 claim 身份，并绑定 Spec、Candidate、Digest path 和规则版本。",
            "同一 Spec 版本只允许一次 Automatic Semantic Repair。",
            "修复 Candidate 必须改变失败 claim 对应的局部 Semantic Fingerprint。",
            "换别名、改格式、重排无关 CTE 或重复同一逻辑不能恢复发布资格。",
            "用户澄清或新权威证据产生新 Spec 后可以重新验证，并重置修复额度。",
            "TTL 过期、事务回滚和明确基础设施失败不消耗语义修复额度。",
            "发布工具一次返回全部 violations、允许的下一动作和原 Candidate 是否永久失效。",
        ],
        "blockers": [("new", "t3"), ("new", "t4")],
    },
    {
        "key": "t6",
        "title": "阻断可证明的 JOIN fanout",
        "build": "实现首个有界 G3 路径：当 Hard Measure/Population Contract、完整关系/度量 lineage 和正式或同快照 Cardinality Evidence 同时存在时，阻断 `COUNT/SUM/AVG` 因 JOIN fanout 被破坏的 Candidate。",
        "criteria": [
            "Measure/Population Contract 与 Cardinality Evidence 分开建模，数据基数不能反向决定业务计数实体。",
            "Query Digest 提供 G3 所需的关系数据流、JOIN、聚合层级、distinct 和度量 lineage。",
            "Cardinality Evidence 区分正式主键/FK/唯一约束与 observed snapshot。",
            "阻断型数据 Probe 与 Candidate 共享事务快照或稳定 dataSnapshot；快照不一致只形成 inconclusive。",
            "Probe Outcome 为 passed、failed、not applicable、unsupported 或 inconclusive，阻断权由 Gate Policy 推导。",
            "历史可证明 fanout 样本被拒绝，预聚合修复、合法 1:N 和明确连接行口径保持可发布。",
            "Probe 失败 Candidate 继承前置票的永久失效和实质修复规则。",
        ],
        "blockers": [("new", "t5")],
    },
    {
        "key": "t7",
        "title": "完成复杂 SQL 的有界适用与 unavailable 策略",
        "build": "把 G1–G3 的能力边界统一为可审计的 Gate Applicability：门外复杂 SQL 不被通用拒绝，门内缺失必需结构也不能被静默视为通过。",
        "criteria": [
            "每个门和方言具有版本化 Gate Applicability Contract。",
            "明确门外查询记录 not applicable，并继续其他门与 Delivery Policy，但不得记录该 facet checked。",
            "门内缺少必需 Digest、lineage 或 Probe 时记录 unsupported/inconclusive，并形成 Review Unavailable。",
            "Applicability 由 Runtime 根据规范查询类别和 Digest 决定，Solver 不能通过目的标签或声明绕过。",
            "产品中必需确定性覆盖 unavailable 时不发布且不能授权绕过。",
            "Spider2 中必需确定性覆盖 unavailable 时不提交；只有确定性门通过后才应用语义 disagreement/unavailable 政策。",
            "复杂 CTE、窗口、集合运算和未支持方言节点具有门外与门内失败的端到端反例。",
        ],
        "blockers": [("new", "t3"), ("new", "t4"), ("new", "t6")],
    },
    {
        "key": "t8",
        "title": "断代移除 Solver 自报合同与自助验证",
        "build": "在产品和 Spider2 已迁移到 Artifact/Receipt 后完成断代切换：模型可见工具、提示词、Host 和评测运行时只保留查询、精确 Artifact 发布和一次修复，不再接受旧 shape 合同或 verification/reconciliation 目的。",
        "criteria": [
            "模型可见查询工具不再接受 verification/reconciliation 目的。",
            "发布工具不再接受 Solver 自报 expected rows、row count、columns 或 SQL 文本作为裁决合同。",
            "提示词不再要求 Solver 自助验证或填写具有裁决权的流程清单。",
            "产品 Host、Spider2、工具目录、事件和报告全部使用新合同。",
            "旧字段和旧目的调用返回明确的 major migration 错误，不存在兼容 fallback。",
            "旧 Token、Authorization 和未发布 Candidate 不能在新 schema 下继续裁决。",
            "完整回归证明没有 last-success/session 级状态或自然语言复述绕过 Publication Receipt。",
        ],
        "blockers": [
            ("new", "t7"),
            ("ext", 52, "迁移产品 Host 到 Artifact 与 Publication Receipt 合同"),
            ("ext", 53, "迁移 Spider2 到 Publication Status 与审查回放"),
            ("ext", 55, "收缩 Solver 自报合同与 session 级旧查询状态"),
        ],
    },
    {
        "key": "t9",
        "title": "持久化可信门控状态与版本身份",
        "build": "让产品 Enforce 在进程重启、并发和版本切换期间仍能恢复 Answer Spec、Candidate 失效、修复额度、Probe、Review Token 和审计链，并在状态无法恢复时 fail-closed。",
        "criteria": [
            "产品 Enforce 使用持久化、追加式 Query Task Store；内存实现只用于测试、开发和 Shadow。",
            "Spec、Evidence、Candidate binding、Probe、Token、Authorization、Receipt 和 Audit Event 均保存稳定身份与版本。",
            "重启后仍能恢复失败 Candidate、已消耗修复额度、当前 Spec 和单次消费 Token 状态。",
            "影响裁决的 Evidence Admission、Digest、parser、dialect、Gate、Probe、Reviewer 和 Delivery Policy 版本进入身份绑定。",
            "无法恢复必需状态时 fail-closed，不重新推断 Approved 或重置修复额度。",
            "同一可信控制面使用事务、访问控制和内容身份；跨信任域对象使用签名或 MAC。",
            "Audit 默认不保存原始结果行，短 TTL Candidate 与长期非敏感审计采用不同保留策略。",
        ],
        "blockers": [
            ("new", "t5"), ("new", "t6"), ("new", "t7"),
            ("ext", 52, "迁移产品 Host 到 Artifact 与 Publication Receipt 合同"),
        ],
    },
    {
        "key": "t10",
        "title": "生成确定性门 replay 与校准报告",
        "build": "复用现有校准基础设施，为 G1–G4 生成冻结候选、正确反例和 SQL 变异的可复现报告，并按规则与方言判断是否具备 Enforce 资格。",
        "criteria": [
            "报告输入包含冻结 Candidate、已复核正确反例、门 claim 标签、方言和完整版本身份。",
            "Gold 只用于离线官方评分，不进入 Answer Spec、Digest、Probe 或 Runtime 门控。",
            "报告分别计算不可豁免门绕过、hard-block precision、正确候选 specificity、支持模式 recall、E2E、non-delivery、timeout、延迟、扫描量和成本。",
            "每种支持模式包含正例、邻近反例和等价改写；纯别名/格式变异不计为修复。",
            "报告展示预注册阈值与逐项通过状态，并按规则和方言分组。",
            "未达标规则保持 Shadow；报告不自动修改运行模式。",
            "固定十题只作为回归集，报告不把预测命中写成已实现的 6–7/10 覆盖率。",
        ],
        "blockers": [
            ("new", "t7"), ("new", "t8"),
            ("ext", 54, "生成 Review Calibration 的 case 与 aspect 报告"),
        ],
    },
    {
        "key": "t11",
        "title": "完成 SQLite 首个 Enforce 资格闭环",
        "build": "以 SQLite 作为首个完整方言切片，根据确定性门校准结果决定每条规则的 Shadow/Enforce 状态，并验证产品、Spider2 和 Circuit Breaker 的端到端行为。",
        "criteria": [
            "SQLite 的 parser、Digest、Gate Applicability、规则和校准身份完整绑定。",
            "只有达到预注册门槛的 SQLite 规则获得 Enforce 权限，未达标规则保持 Shadow。",
            "产品对不可豁免失败和必需覆盖 unavailable 保持 fail-closed。",
            "Spider2 对确定性失败不提交，对确定性通过后的语义 disagreement 或 Reviewer unavailable 正确记录。",
            "规则异常时回滚到最近已校准 SQLite 版本；无可回滚版本时必需检查 fail-closed。",
            "上线报告包含误阻断、non-delivery、E2E、延迟、扫描量和成本变化。",
        ],
        "blockers": [
            ("new", "t9"), ("new", "t10"),
            ("ext", 51, "实现 Review 模式与 Assurance Circuit Breaker"),
        ],
    },
    {
        "key": "t12",
        "title": "将有界确定性门控扩展到 MySQL",
        "build": "为 MySQL 建立独立 AST coverage、Gate Applicability、校准身份和发布模式决定，使其不能复用 SQLite 的 Enforce 资格。",
        "criteria": [
            "MySQL 方言 fixture 覆盖 G1–G3 所需的 JOIN、聚合、窗口、NULL、LIMIT 和 lineage。",
            "MySQL parser 缺口准确区分门外 not applicable 与门内 unavailable。",
            "G1–G4 replay 按 MySQL 规则和版本生成独立校准报告。",
            "只有达到门槛的 MySQL 规则获得 Enforce；未达标规则保持 Shadow。",
            "MySQL 的产品/Spider2 发布结果与 Circuit Breaker 行为通过端到端测试。",
        ],
        "blockers": [("new", "t11")],
    },
    {
        "key": "t13",
        "title": "将有界确定性门控扩展到 BigQuery",
        "build": "为 BigQuery 建立独立 AST coverage、Gate Applicability、校准身份和发布模式决定，重点覆盖窗口、QUALIFY 和 BigQuery 方言结构。",
        "criteria": [
            "BigQuery fixture 覆盖 G1–G3 所需的聚合、窗口、QUALIFY、集合运算、NULL 和 lineage。",
            "BigQuery 特有节点不会被 tokenizer 或其他方言规则伪装成 checked。",
            "G1–G4 replay 按 BigQuery 规则和版本生成独立校准报告。",
            "只有达到门槛的 BigQuery 规则获得 Enforce；未达标规则保持 Shadow。",
            "BigQuery 的产品/Spider2 发布结果与 Circuit Breaker 行为通过端到端测试。",
        ],
        "blockers": [("new", "t11")],
    },
    {
        "key": "t14",
        "title": "将有界确定性门控扩展到 Snowflake",
        "build": "为 Snowflake 建立独立 AST coverage、Gate Applicability、校准身份和发布模式决定，使 Snowflake 方言缺口不会继承其他方言的确定性资格。",
        "criteria": [
            "Snowflake fixture 覆盖 G1–G3 所需的聚合、窗口、QUALIFY、集合运算、NULL 和 lineage。",
            "Snowflake 特有节点准确产生 checked、not applicable 或 unavailable。",
            "G1–G4 replay 按 Snowflake 规则和版本生成独立校准报告。",
            "只有达到门槛的 Snowflake 规则获得 Enforce；未达标规则保持 Shadow。",
            "Snowflake 的产品/Spider2 发布结果与 Circuit Breaker 行为通过端到端测试。",
        ],
        "blockers": [("new", "t11")],
    },
]


def gh_json(args):
    raw = subprocess.check_output(["gh", *args], text=True, encoding="utf-8")
    return json.loads(raw)


def blocker_lines(ticket, created):
    lines = []
    by_key = {item["key"]: item for item in TICKETS}
    for blocker in ticket["blockers"]:
        if blocker[0] == "new":
            key = blocker[1]
            if key not in created:
                raise RuntimeError(f"unresolved blocker {key} for {ticket['key']}")
            lines.append(f"- #{created[key]} — {by_key[key]['title']}")
        else:
            lines.append(f"- #{blocker[1]} — {blocker[2]}")
    return lines or ["- 无，可以立即开始。"]


def body_for(ticket, created):
    lines = [
        "## Parent", "", PARENT, "",
        "## What to build", "", ticket["build"], "",
        "## Acceptance criteria", "",
    ]
    lines.extend(f"- [ ] {item}" for item in ticket["criteria"])
    lines.extend(["", "## Blocked by", ""])
    lines.extend(blocker_lines(ticket, created))
    lines.append("")
    return "\n".join(lines)


def main():
    existing = {
        item["title"]: item["number"]
        for item in gh_json(["issue", "list", "--repo", REPO, "--state", "all", "--limit", "500", "--json", "number,title"])
    }
    created = {}
    results = []
    for ticket in TICKETS:
        if ticket["title"] in existing:
            number = existing[ticket["title"]]
            created[ticket["key"]] = number
            url = f"https://github.com/{REPO}/issues/{number}"
            results.append({"key": ticket["key"], "number": number, "title": ticket["title"], "url": url})
            print(f"{ticket['key']}: reuse #{number} {url}")
            continue
        body = body_for(ticket, created)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as handle:
            handle.write(body)
            body_path = Path(handle.name)
        try:
            url = subprocess.check_output([
                "gh", "issue", "create", "--repo", REPO,
                "--title", ticket["title"], "--body-file", str(body_path),
                "--label", "ready-for-agent",
            ], text=True, encoding="utf-8").strip()
        finally:
            body_path.unlink(missing_ok=True)
        number = int(url.rstrip("/").split("/")[-1])
        created[ticket["key"]] = number
        results.append({"key": ticket["key"], "number": number, "title": ticket["title"], "url": url})
        print(f"{ticket['key']}: #{number} {url}")

    output = Path(".artifacts/bounded-query-gates-ticket-map.json")
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved mapping: {output}")


if __name__ == "__main__":
    main()
