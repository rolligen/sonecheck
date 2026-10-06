# v0.1.1 设计 — honest-jev

> 结构唯一权威：`dev-meta/docs/02-version-rules.md` §5。
> ⚠️ 本文件不得出现 `Transaction Flow` / `TF` / `Step` 章节（施工拆分属 `400-build.md`）。
> 需求侧范围与验收见 `200-spec.md`；施工拆分见 `400-build.md`。

---

## 1. 架构背景与目标

- **架构目标**：把 `infra/jevClient` 从本地 mock 换成真实 HTTP 客户端（超时 / 重试 / 错误归一 / 并发），并为「未配置 Key」建立宽限跳过路径——`02` §2 对 `infra/jevClient` 的职责定义（「超时、重试、错误归一的唯一归属处」）首次完全兑现。
- **上一版本基线**：`v0.1.0` 已交付三层 TS 工程 + mock 判定链路（T1 51 例 / 5 守卫 / 契约 lint 全绿，tag `v0.1.0`）。`02` §3 的「异步 HTTP + 并发上限 4」与 `02` §4 的并发模型尚未落地。
- **外部约束**：Jev 注册暂停（2026-09-22）——按 `ADR-007`，本版验收与实测对 `tools/jev-mock/` 契约仿真端点执行，`sonecheck.endpoint` 可配置。
- **影响范围**：`extension/src/**`（3 个文件重写 / 4 个文件增量）、新增 `tools/jev-mock/`（不进产物）；`docs/03`（超时/重试定案、endpoint、`ERR-08` 语义）、`docs/04`（状态表）、`docs/05` §2.2（范围重写）。

---

## 2. 架构与分层

- **全局架构**：沿用 `02` §1 三层单向分层，不新增层。
- **分层落位（本版增量）**：

| 层 | 文件 | 本版变更 | 禁止 |
|---|---|---|---|
| 跨层常量 | `src/constants.ts` | 增量：`REQUEST_TIMEOUT_MS=500`、`RETRY_MAX_ATTEMPTS=1`、`RETRY_BACKOFF_MS=150`、`MAX_CONCURRENCY=4`、`JEV_ENDPOINT_DEFAULT` | 纯数据模块，不 import 任何层 |
| UI | `src/ui/commands.ts` | 增 `sonecheck.setApiKey` 注册；`inspectDiff` 增未配 Key 宽限短路（`ADR-006`） | 直连 SecretStorage / HTTP |
| UI | `src/ui/status.ts` | 增「未配置 Key」瞬时态与一次性引导通知（带按钮直达命令） | — |
| Core | `src/core/riskEngine.ts` | 判定调用改为**并发上限 4** 的批量编排（semaphore）；`failure` 块剔除出清单并聚合上报 | 引用 `vscode` 做 IO |
| Core | `src/core/config.ts` | `endpoint` 归一（空 / 非 https → 回退默认） | — |
| Infra | `src/infra/jevClient.ts` | **重写**：真实 `fetch` 客户端（wire 组装、超时、重试、错误归一）；`createMockJevClient` 工厂保留（测试注入用） | 依赖 `vscode` |
| Infra | `src/infra/secrets.ts` | **新建**：SecretStorage 读写唯一出口（`hasApiKey` / `getApiKey` / `setApiKey` / `clearApiKey`，签名以 `02` §2 模块表为准） | Key 明文出现在其他任何文件 |
| Infra | `src/infra/configSource.ts` | 增读 `sonecheck.endpoint` | 承载业务判断 |

- **Facade**：两个 Facade 增量 re-export（`secrets` 的 `hasApiKey` / `getApiKey` / `setApiKey` / `clearApiKey`；`jevClient` 的错误码类型）。
- **本版不建的模块**：`src/infra/logger.ts` 仍不建（O2 埋点顺延，见 `200-spec` §1.1）。

### 2.1 防腐设计

| 关注点 | 设计约束 |
|---|---|
| 类型边界 | `vscode` 类型只允许出现在 `src/ui/**`、`src/extension.ts`、`src/infra/configSource.ts`、**`src/infra/secrets.ts`**（`SecretStorage` 由 `context` 注入，经装配层传递） |
| Key 边界（`INV-03`） | Key 的明文只允许存在于 `infra/secrets.ts` 的内存局部变量与 SecretStorage 之间；`jevClient` 经**注入函数**（`() => Promise<string \| null>`）取 Key，自身不持有引用；守卫 `GUARD-06` |
| 错误域边界 | 网络失败**不抛未分类异常**：`decide` 恒 resolve，失败以 `DecisionResult.failure` 表达（见 §4.4）；`core` 不 `try-catch` 网络错误；本地失败（`ERR-06/07/09`）语义沿用 `v0.1.0` |
| 兼容边界 | `0.1.0 → 0.1.1` 升级零破坏：未配 Key 宽限跳过（`ADR-006`）；`CFG-01` 只纯增量（`sonecheck.endpoint`） |
| 工程登记 | `tools/` 不进 `.vsix`；`wrangler` 仅 devDependency；`test:integration` 脚本随本版落盘 |

---

## 3. 数据流与状态机

**关键数据流**（沿用 `02` §3，步骤 8–10 为本版变更点）

| 步骤 | 发起方 | 接收方 | 数据 |
|---|---|---|---|
| 1–7 | （同 `v0.1.0`：命令 → 配置归一 → git → diffParser → contextBuilder） | — | — |
| 8 | `core/riskEngine` | `infra/secrets` | 查询 Key 可读性；未配置 → 宽限短路（宽限结果直达步骤 11） |
| 9 | `core/riskEngine` | `infra/jevClient` | payload 数组，**并发上限 4** 的批量 `decide`（`02` §4 并发模型） |
| 10 | `core/riskEngine` | `core/threshold` | `DecisionResult[]`（`failure` 块已剔除）→ `RiskItem[]` |
| 11 | `ui/commands` | `ui/status` | 清单、All Clear、或**降级聚合提示**（一次性，含 `ERR-*` 归因） |
| 12 | `ui/riskList` | VS Code 编辑器 | （同 `v0.1.0`） |

**状态跃迁**（`02` §4 补全 `Degraded` 分支）

| 状态 | 说明 | 跃迁条件 |
|---|---|---|
| `Idle` → `Collecting` → `Deciding` | （同 `v0.1.0`） | — |
| `Deciding` | 并发判定（≤4） | 全部成功 → `Reporting`；部分失败 → `Reporting`（降级聚合，`Degraded` 分支） |
| `Deciding` → `Idle` | 未配 Key 宽限 | 一次性引导 + 状态栏瞬时提示，不进错误态（`ADR-006`） |
| `Reporting` | 清单 / All Clear / 降级提示 | 用户关闭 → `Idle` |

---

## 4. 核心算法方案

### 4.1 wire 组装与响应解析

- **请求**：复用 `v0.1.0` 已落盘的 `serializePayload`（camelCase → snake_case，单测已覆盖 `INV-02`）；外层装入 `03` §2.1 的 `state` + `questions`（`risk_score` 为 `noul` 型、`reason_code` 为 `choice` 型，`criteria` 取自 §2.4 枚举——`ADR-005`）。**一次请求两 question 并行**已由实测支撑：同一 payload 下 1q 中位 174ms / 2q 中位 190ms（+16ms，输出 token 21→84），与官方 "Parallel questions" 的并行收益一致。
- **`instructions` 结构化（判定质量杠杆，非可选）**：上游支持 `instructions` 为对象 / 数组，并可在文本中用**反引号引用 `state` 内的字段名**；`noul` 另支持可选 `criteria: {true, false}`（2026-10-06 官方 API reference 核实）。本版据此把两个 question 的 `instructions` 写成结构化（问题 + 对 `state` 字段的显式引用），并给 `risk_score` 补 `true` / `false` 语义描述。**依据**：实测显示 `noul` 判定对 `state` 噪声高度敏感——同一段鉴权代码，`state` 干净时 `noul = 0.97`，`diff_hunk` 被填充噪声后降至 `0.26`（低于阈值 0.4）；payload 质量直接决定判定质量，故此为必需项。
- **响应**：`answers.risk_score.noul` → `score`；`answers.reason_code.choice` → `reasonCode`；响应 `model` 字段记入结果供追溯（O2 落地前仅随 `failure` 诊断面保留，不做运行期日志）。`decision` 仍由本地按 `riskThreshold` 派生（`03` §2.1 本地派生表）。
- **schema 校验**：缺字段 / 越界 / 枚举外取值 → 该块 `failure: 'ERR-05'`，其余块不受影响。

### 4.2 超时与重试（`ADR-007` 定案值）

- 超时：`AbortController` + `REQUEST_TIMEOUT_MS = 500`；超时 → `ERR-02`（**不重试**）。
- 重试：仅 `429` / `529` 重试 `RETRY_MAX_ATTEMPTS = 1` 次，退避 `RETRY_BACKOFF_MS = 150`；其余非 2xx 不重试。
- 归一：连接层失败 → `ERR-01`；本地计时超时 → `ERR-02`；非 2xx（非 401/422/429/529）→ `ERR-03`；`401` / `429` / `529` → `ERR-04`；`422` 或 schema 不合规 → `ERR-05`。
- 限流路径实际上界 ≈850ms（实测限流响应 ~200ms + 退避 150ms + 重试 ≤500ms），< `00` §3 端到端 p95 ≤ 1s；超时路径不重试，故不与超时上界叠加。

### 4.3 并发模型（`02` §4 落地）

- `core/riskEngine` 内实现 ~30 行 semaphore（无第三方依赖）：在飞请求 ≤ `MAX_CONCURRENCY = 4`，完成一个补位一个，结果按提交顺序聚合（**稳定性**：不改变阈值过滤的输入顺序，Top-K 排序确定性不受影响）。
- 并发只收敛网络等待；解析 / 截取 / 过滤保持串行纯函数（复杂度结论不变）。

### 4.4 降级信号（`DecisionResult` 纯增量）

- `decide` **恒 resolve**（`ADR-002` 不变量「失败不向上抛业务错误」的延续）；失败块返回 `{ score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY', failure: 'ERR-01'~'ERR-05' }`。
- `failure` 为**内部类型可选字段**（纯增量，不触 `IJevClient` 签名与 wire 契约）：`core/riskEngine` 将 `failure` 块剔除出清单（放行 = 不入清单），并聚合为一个**一次性**降级提示（`ui` 层呈现，含归因码）。
- **为什么不是 reject**：reject 会让「部分成功」的批量结果只能整体放弃，违反 `INV-04` 的逐块降级语义。

### 4.5 Key 生命周期（`API-03` + `ADR-006`）

- 写入：`showInputBox({ password: true })` → `infra/secrets.setApiKey`；取消 → `ERR-10`（无副作用）；空串 → 二次确认 → `clearApiKey`（`ERR-11`）。
- 读取：每次检查前经 `infra/secrets.hasApiKey` 查询可读性；未配置 → 宽限短路（首次引导带按钮，后续状态栏瞬时提示）。
- 明文纪律：输入框 `password: true`；任何提示 / 日志 / 出站内容不回显（`INV-03`，守卫 `GUARD-06`）。

### 4.6 契约仿真端点（`tools/jev-mock/`，`ADR-007`）

- Cloudflare Worker 兼容模块（`export default { fetch }`，零运行时依赖）：`npx wrangler dev` 本地起服务、`npx wrangler deploy` 一键部署；`wrangler` 仅 devDependency。
- 契约面 = `03` §2.1（请求 / 响应 / 错误码全集）；故障注入经请求头 `x-jev-mock-fault`：`disconnect` → `ERR-01`、`timeout` → `ERR-02`、`http500` → `ERR-03`、`badschema` → `ERR-05`、`unauthorized`(401) / `forbidden`(403) / `rate429`(429) / `rate529`(529) → `ERR-04`（该错误码的四个上游状态码全覆盖）。**校验严格度以 2026-10-06 真实端点实测为准**（未知 `type` → 400 · `choice` 缺 `criteria` → 422 · 缺 `model` → 422 · `noul` 缺 `instructions` 且无 `criteria` → 400）——**mock 不得比上游宽松**，否则 S2 的 T2 假绿。
- 双用途：T2 契约测试的连接目标 + S7 真机验收的端点；不进 `.vsix`。
- **定位演进（2026-10-06 修订）**：Jev Key 已到位、真实端点可用后，本端点**从「注册暂停期的替身」改为「可编程故障注入夹具」**——真实端点无法按需制造 `disconnect` / `timeout` / `badschema` / `429` / `500`，故 `ERR-01`~`ERR-05` 与 `INV-04` 的自动化证据只能由本端点提供；真实端点则专责「上游真实分布校准」（延迟、`noul` 分布、schema 漂移）。两者职责不重叠，互不替代（`ADR-007` 的决策本身不变，仅理由更新，按 ADR 纪律不改其原文）。

---

## 5. 关键决策（ADR）

| 决策 | ADR | 备选方案 | 选择理由 | 影响 |
|---|---|---|---|---|
| `ERR-08` 改宽限跳过（未配 Key 不算失败） | [ADR-006](../../adrs/adr-006.md) | 维持 ERROR 终止；每次提示；完全静默 | 升级零破坏；`INV-01` / `US-03` 延伸 | `03` §2.2 / §4 语义变更；`04` §2 补状态 |
| 契约仿真端点（Worker）+ endpoint 可配置 + 超时/退避工程定案 | [ADR-007](../../adrs/adr-007.md) | 等注册恢复；MSW 进程内拦截；第三方 mock 库；顺序 + 放宽验收线 | 代码全真、验收不被外部注册状态阻塞；欠一次校准已显式挂账 | `CFG-01` 纯增量 `sonecheck.endpoint`；T2 / S7 对仿真端点执行 |
| 并发 4 由调用方（`riskEngine`）编排 | —（沿用 `02` §4 既定设计，不涉技术栈选型） | jevClient 内部批量接口 | `IJevClient` 冻结签名（`ADR-002`）是逐块 `decide`，批量语义属编排层 | semaphore 落 `core/riskEngine` |
| `DecisionResult` 增可选 `failure` 字段 | —（内部类型纯增量，见 §4.4） | reject 分类异常；整体布尔降级 | 保留「部分成功」结果；签名零变更 | 剔除逻辑归 `core`，提示归 `ui` |

**沿用决策（不重复论证）**：手写 `fetch`（[ADR-004](../../adrs/adr-004.md)）、`noul` 原语（[ADR-005](../../adrs/adr-005.md)）、接口隔离与 mock 同签名（[ADR-002](../../adrs/adr-002.md)）。

---

## 6. 与现有版本的继承关系

| 现有能力 / 模块 | 本版本变更 |
|---|---|
| `src/infra/jevClient.ts`（mock 实现） | **重写**为真实客户端；`scoreHunk` / `createMockJevClient` 移入 `test/` 作 T1 fixture（打分权重与 Harness 数据仍可追溯） |
| `IJevClient` 抽象 | **零变更**（`ADR-002` 兑现：只换实现，调用方不动） |
| `src/infra/secrets.ts` | **新建**（`v0.1.0` 登记的预留位） |
| 命令集 | 增 `sonecheck.setApiKey`；`sonecheck.inspectDiff` 行为不变（新增宽限前置分支） |
| `CFG-01` | 纯增量 `sonecheck.endpoint`；其余 4 项不变 |
| `docs/03` | 超时 / 重试 TODO 定案（`ADR-007`）；`ERR-08` 语义变更（`ADR-006`）；翻牌集合见 `200-spec` §1 |
| 根目录 npm 占位包 | **不变**，本版不触碰 |

---

## 7. 测试策略

| 关注点 | 测试级别 | 关键场景 | 环境依赖 |
|---|---|---|---|
| （T1 基线）diff 解析 / 上下文 / 打分 fixture / 过滤 / 归一 | T1 单元 | 沿用 `v0.1.0` 51 例基线（棘轮，只增不删） | 纯 Node |
| endpoint 归一 | T1 单元 | 空 / 非 https / 合法 URL → 回退或采纳 | 纯 Node |
| 并发编排 | T1 单元 | 在飞 ≤4 / 结果按提交顺序聚合 / 全失败返回空清单 | 纯 Node（内存 stub 计数） |
| Key 生命周期 | T1 单元 | 取消无副作用 / 空串二次确认 / `secrets` 外无明文（`GUARD-06` 同源断言） | 纯 Node（SecretStorage stub） |
| **wire 组装与解析** | T1 单元 | `serializePayload` 增量断言（`state`/`questions` 外层）；响应 schema 三类不合规 → `ERR-05` | 纯 Node |
| **故障降级全谱** | **T2 契约**（首次引入） | 仿真端点注入 8 个状态码（`disconnect`/`timeout`/`http500`/`badschema`/`unauthorized`/`forbidden`/`rate429`/`rate529`）→ 各归 `ERR-01`~`ERR-05`、放行、一次性聚合 | 真实 HTTP（`local.mjs` 仿真端点） |
| **超时与重试** | T2 契约 | 500ms 超时触发（断言耗时 ≈500ms）；`429` 恰好重试 1 次（退避 150ms）；重试计数断言 | 同上 |
| **Key 泄漏** | T2 契约 | 出站请求体与错误路径不含 Key 明文 | 同上 |
| 真机八项 | T3 端到端 | `200-spec` §2 逐项（对仿真端点） | Extension Host（人工验证） |

> **层级口径**：沿用 `01` §3。本版**首次引入 T2**——判定越过进程边界（HTTP），跨进程契约必须有可执行断言；MSW 不启用（`ADR-007`），T2 直连仿真端点。T1 不得 mock 网络层（红线不变）。

**测试基线（棘轮，只升不降）**：`v0.1.0` 收口 T1 = 51 例 / 8 文件——本版不得删除或降断言；T2 为新增域（目标 ≥8 例）；T3 = 真机 8 场景（`200-spec` §2）。删除或跳过用例须在 `400-build` §2 对应 Step 标注理由。

- **测试目录**：T1 在 `test/`（`GUARD-03` 不扫，沿用）；T2 在 `test/integration/`（起 `wrangler dev` 子进程或复用已部署端点，经 `sonecheck.endpoint` 注入）。
- **不写单测的部分**：`ui/**` 原生控件交互（通知按钮、输入框）以 T3 真机验证替代——依据见 `01` §3。
