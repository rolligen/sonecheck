# sonecheck - 契约与 API (Contracts SSOT)

> **文档流向纪律**：本文档严格依赖 upstream `00_PRODUCT_REQUIREMENTS.md`、`01_TECHNICAL_SPEC.md` 与 `02_SYSTEM_DESIGN.md`。
> 本文档定义系统**不可变式、数据类型、存储 Schema 及 API 契约**，作为下游实现与测试的**只读 SSOT**；**不引用下游，也不声明下游引用方**（引用方向严格单向）。
> **占位符约定**：`{{FIELD}}` = 结构化命名字段；`<!-- TODO: [dm-init-docs] <说明> -->` = 待补充内容。
> **权威引用**：契约记录规范（四要素 + 域-序号编号）与失败面契约见 `dev-meta/docs/06-contract-based-dev.md` §4 / §5（唯一权威）；契约**状态生命周期**见 §4.2；契约**资产组织 / 索引 / 归档**见 §6；**引用与定位纪律**（单向引用 / 语义锚点 / 禁写现状 / 结构 lint）见 §7；契约只读纪律见 §8。本文只落地，不重定义。

---

## 1. 不可变式规则 (Invariants)

> **违反以下任何一条即表示系统处于损坏状态**（写实现与测试的第一判据）。

| 编号 | 状态 | 不变式 | 归属 | 方向 | 真值来源 | 可执行验证 |
|------|------|--------|------|------|----------|-----------|
| INV-01 | `[CURRENT]` | 检查流程不得阻断、取消或延迟用户的提交动作；检查的全部失败都必须以「放行」收尾 | `core/riskEngine` | 内部 | 本文 §1 + `00` §3 可用性 | 单测：`test/riskEngine.test.ts`（本地失败以 `ERR-*` 分类失败抛出、成功路径恒返回 `RiskItem[]`）；`ui/commands.ts` 的 `catch` 不重抛 |
| INV-02 | `[CURRENT]` | 任何离开本机的 payload 只含 diff hunk 与该 hunk 的限长上下文（**单块 payload ≤ 2KB = 2048 字节，含 `context_code`**），**不得包含完整源文件** | `core/contextBuilder` | 出站 | 本文 §2.1 Request | 单测：`test/contextBuilder.test.ts` 断言 payload 序列化总长 ≤ 2048；`test/diffParser.test.ts` 断言切分后单块不越界 |
| INV-03 | `[PLANNED]` | Jev API Key 不得以明文出现在工作区文件、日志、遥测、错误信息或 UI 文本中 | `infra/secrets` | 内部 | 本文 §3 | `grep -rn "jevApiKey" src/ \| grep -v "infra/secrets.ts"` 须无输出；单测：日志字段不含 Key 值 |
| INV-04 | `[CURRENT]` | Jev 不可用（网络失败 / 超时 / 配额耗尽 / 非 2xx）时必须降级为「静默放行 + 一次性提示」，不得向上抛错终止流程 | `infra/jevClient` | 内部 | 本文 §4 `ERR-01`–`ERR-04` | T2 契约测试（`test/integration/jevContract.test.ts`）：对契约仿真端点注入 `disconnect` / `timeout` / `http500` / `401` / `403` / `429` / `529` / `badschema` → 断言 resolve 且 `failure` 归类正确、**无一抛异常**、重试次数符合策略 |
| INV-05 | `[CURRENT]` | 检查过程对工作区严格只读：不得修改、暂存、格式化或删除任何文件 | `infra/git` | 内部 | `02` §3 边界说明 | 单测：`test/git.test.ts` 断言调用前后 `git status --porcelain` 完全一致；`grep`：`src/infra/git.ts` 只出现 `diff` / `rev-parse` 子命令 |
| INV-06 | `[CURRENT]` | 清单中每一项必须可定位到真实存在的文件与行号（禁止展示无法跳转的条目） | `ui/riskList` | 内部 | 本文 §2.2 | 单测：`test/threshold.test.ts`（不可定位即剔除）与 `test/riskEngine.test.ts`（清单项的 `filePath` / `startLine` 可在真实文件中解析） |
| INV-07 | `[CURRENT]` | 风险阈值等判定参数必须来自命名常量或配置，禁止在判定逻辑中硬编码字面量 | `core/threshold` | 内部 | `02` §2 `core/threshold`（`RISK_THRESHOLD` 命名常量） | `grep -rnE "\b0\.4\b\|\b2048\b" src/ \| grep -v "constants.ts"` 须无输出 |

**每条契约的必标项**（`dev-meta/docs/06` §4 + §4.2）

| 项 | 说明 |
|----|------|
| 编号 | 域-序号（如 `INV-01` / `API-03`）；新增沿用本规则并登记本表 |
| **状态** | `[CURRENT]` 现行 ｜ `[PLANNED]` 已立规未落地 ｜ `[HISTORY]` 已过时。**一条一标**；S3 实测回填后由 `[PLANNED]` 翻 `[CURRENT]` |
| 不变性 | 跨调用必须成立的约束（**可判定**；**禁写「代码现状」**，现状会腐化） |
| 归属 / 方向 / 真值来源 | 谁兑现 / 调用方向 / 可校验出处（代码 / ADR / 章节） |
| **可执行验证** | 须指向可执行断言（单测名 / `grep` 命令 / 编译约束），不可只写文字描述 |

**语义锚点（供精确引用，`dev-meta/docs/06` §7.2）**

```markdown
### INV-02 出站 payload 不得含完整源文件 <a id="inv-no-full-source-egress"></a>

- 状态：`[CURRENT]`
- 不变性：任意出站请求体中，单块 payload（含 `context_code`）长度 ≤ 2048 字节，且不含 hunk 之外的未改动文件全文。
```

引用形态：`docs/03_CONTRACTS_AND_API.md#inv-no-full-source-egress` —— slug 全小写连字符、全仓唯一，**不用数字锚点**（数字会随编号调整漂移）。

---

## 2. API 接口定义

### 2.1 `API-01` JevDecision（出站：sonecheck → Jev）

- **状态**：`[CURRENT]`
- **生效版本**：`v0.1.0` 兑现**签名与本地派生字段**（`infra/jevClient` 为本地 mock，不发网络、不涉及 API Key）；**`v0.1.1` 兑现完整真实链路**（`fetch` + 超时 + 重试 + 五类归一 + 失败面 `ERR-01`~`ERR-05`），T2 契约测试对契约仿真端点全绿（`ADR-007`）
- **Path**：`POST <endpoint>`——默认 `https://api.typesafe.ai/v1/systemone`，可经 `CFG-01` 的 `sonecheck.endpoint` 覆盖（`ADR-007`）
- **鉴权**：`Authorization: Bearer <API_KEY>`（Key 存 VS Code SecretStorage，见 §3 `CFG-01`）。**Key 获取**：登录 Playground 后在 `https://console.typesafe.ai/keys` 创建；官方 SDK 的环境变量名为 `TYPESAFE_API_KEY`（本项目不引 SDK，见 `ADR-004`，该变量名仅供脚本化冒烟使用）
- **Header**：`Content-Type: application/json`
- **归属 / 调用方**：`infra/jevClient` / 由 `core/riskEngine` 调用
- **幂等性**：幂等（同一 `state` + `questions` 重复提交返回语义等价判定）
- **超时**：单请求超时上限 **500ms**（定案依据 2026-10-06 真实端点实测：会话内**首请求 429ms**（冷 TLS + 服务端预热）、稳态 152–213ms；原定 400ms 会在冷启动误触发 `ERR-02`；500ms 等于 `00` §3 单块判定预算上限，不破层级）；超时视为 `ERR-02` 走降级，**不重试**。**S3 复核（2026-10-06，36 次真实调用）**：单请求 p50 169–238ms、p90 240–399ms、观测最大 426ms，**0 次误触发**；余量约 15%–37%，属**薄余量**——公网长尾抖动可能偶发 `ERR-02`，该块按 `INV-04` 放行，不影响其他块
- **版本兼容性**：请求侧**固定版本 ID** `model: "jev-1.13.0"`，**不使用 `jev-latest` / `jev-preview` 浮动别名**——上游明确建议需要结果可复现时固定 ID（别名会随新版本自动迁移，客户端不改而回答会变）；且本项目的 `riskThreshold` 系按分布校准，模型漂移会直接使校准失效。响应体 `model` 字段返回**实际执行的版本**，须随判定结果留痕以便追溯口径变化。**升级路径为主动动作**：先在 S3 / 目标版本用真实端点复核新版本表现（含阈值重校准），确认后再改本字段与 `constants.ts`
- **上游规范**：TypeSafe 官方 API reference（`https://docs.typesafe.ai/api`）为唯一权威；本节只登记**本项目使用的子集**，不重定义上游语义。**全文参考快照**（端点 / 三型 question / 响应 / 错误码全集 / 模型版本 / `confidence` 公式 / 实测校准）见 `docs/reference/jev-api.md`——只读参考，非我方契约

**Request**（全部输入装入 `state`；`questions` 为原子问题映射，key 由本项目定义）

```json
{
  "model": "jev-1.13.0",
  "state": {
    "file_path": "string  // 仓库相对路径",
    "change_type": "MODIFY | ADD | DELETE",
    "diff_hunk": "string  // 本块增删行原文",
    "context_code": "string  // 该块所在作用域的限长上下文（计入单块 payload 上限 ≤2048 字节）",
    "local_metadata": {
      "is_exported": "boolean  // 是否导出符号",
      "caller_count": "number   // 本地静态分析得到的引用计数",
      "touches_sensitive_path": "boolean  // 是否命中敏感路径规则"
    }
  },
  "questions": {
    "risk_score": {
      "type": "noul",
      "instructions": "string  // 对该 hunk 的安全性与缺陷风险给出 0–1 判定"
    },
    "reason_code": {
      "type": "choice",
      "instructions": "string  // 按 §2.4 枚举给出主要风险归因",
      "criteria": "map<string, string>  // key 为 §2.4 的枚举值，value 为该类的判定说明"
    }
  }
}
```

**Response**（上游原样返回，本项目**不改编**）

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "risk_score": { "type": "noul", "noul": 0.91 },
    "reason_code": {
      "type": "choice",
      "choice": "AUTH_BOUNDARY",
      "probabilities": { "AUTH_BOUNDARY": 0.88, "DATA_WRITE": 0.12 },
      "confidence": 0.81
    }
  },
  "usage": { "input_tokens": 296, "output_tokens": 20 }
}
```

**本地派生**（以下字段**不在** API 响应中，由 `core/riskEngine` 在本地计算）

| 本项目字段 | 派生方式 |
|---|---|
| `score` | `answers.risk_score.noul` |
| `decision` | `answers.risk_score.noul >= riskThreshold ? "AUDIT" : "PASS"`（阈值见 §3 `CFG-01`） |
| `reasonCode` | `answers.reason_code.choice`（取值见 §2.4） |

> **不采用 `score` 原语**：`noul` 直接给出 0–1 概率，便于与用户自定义阈值做浮点比较；`score` 原语（2–10 级有序谱系）附带的 `legend` 分级理由在 v0.1.x 无消费场景。

**失败面（Failure Face）**

| 错误码 | 上游状态码 | 场景 | 返回约定 | 是否静默 |
|--------|-----------|------|----------|----------|
| `ERR-01` | —（连接层） | 网络不可达 / DNS 失败 | 判定结果记为「未知」，按 INV-04 放行 | 否（一次性提示） |
| `ERR-02` | —（本地计时） | 请求超时 | 同上 | 否（一次性提示） |
| `ERR-03` | 非 2xx 且非下表 | 其他非 2xx 响应 | 同上，日志记录状态码 | 否（一次性提示） |
| `ERR-04` | `401` / `403` / `429` / `529` | 鉴权失败（Key 错误 `401` / 未带 Key 头 `403`）/ 超配额 / 上游过载 | 同上，提示用户检查 API Key；`429` / `529` 先指数退避重试 | 否（一次性提示） |
| `ERR-05` | `400` / `422` | 请求不合规（未知 question `type`、`noul` 缺 `instructions` 且无 `criteria` → `400 api_usage_error`；缺字段 / `choice` 缺 `criteria` → `422`），或响应 schema 不合规（缺字段 / 越界 / `reason_code` 不在枚举内） | 请求侧不合规与响应侧不合规**均**丢弃该块不计入清单 | 否（写入日志） |

- **重试策略**：仅对 `429` / `529` 重试 **1 次**（退避 150ms，`ADR-007` 定案），其余状态码不重试；该路径的实际上界 ≈850ms（实测限流响应 ~200ms + 退避 150ms + 重试 ≤500ms），仍在 `00` §3 端到端 p95 ≤ 1s 内——超时路径不重试，故不与超时上界叠加。本项目**手写 `fetch` + 退避函数**，不引入官方 SDK（避免额外依赖，见 `01` §2 依赖限制）。
- **错误体不解析**：上游错误体的 `detail` 形态**不固定**（对象 / 数组 / 字符串三种均出现过，如 `422` 返回逐字段的校验明细）。本项目**只按状态码归一、不解析 body**——上游改文案或改明细结构都不会影响归一逻辑；错误体的原文仅在需要人工排查时由人直接查看。
- **严禁静默吞错**：纯函数式失败返回空 / 原值而非 nil；危险失败不得静默，须调用前拦截并显式暴露（`dev-meta/docs/06` §5）。

---

### 2.2 `API-02` 命令 `sonecheck.inspectDiff`（VS Code 命令契约）

- **状态**：`[CURRENT]`
- **生效版本**：`v0.1.0` 兑现命令注册与三个本地失败面（`ERR-06` / `ERR-07` / `ERR-09`）；`ERR-08`（Key 未配置）随 `API-03` 归 `v0.1.1`
- **Path**：VS Code 命令 ID `sonecheck.inspectDiff`
- **Method**：命令调用（无参）
- **归属 / 调用方**：`ui/commands` / 由用户经命令面板、快捷键或状态栏触发
- **幂等性**：幂等；检查进行中重复触发复用进行中的 Promise，不另起流程（`02` §4）
- **返回语义**：无返回值；结果经 UI 呈现。**失败一律以放行收尾**（INV-01）

**Request**：无参（配置经 `workspace.getConfiguration("sonecheck")` 读取，见 §3 `CFG-01`）

**Response**：无返回值（副作用为 UI 呈现）

**失败面（Failure Face）**

| 错误码 | 场景 | 返回约定 | 是否静默 |
|--------|------|----------|----------|
| `ERR-06` | 工作区非 git 仓库 | 提示一次，终止 | 否 |
| `ERR-07` | 暂存区无改动 | 提示一次「无暂存改动」 | 否 |
| `ERR-08` | API Key 未配置 | 宽限跳过：首次一次性引导（`ADR-006`），检查视为零风险放行 | 否 |
| `ERR-09` | git 可执行文件缺失 | 提示一次，终止 | 否 |

> `ERR-08` 归属 `API-02`（Key 前置校验），生效版本为 `v0.1.1`，自 `ADR-006` 起为**宽限跳过语义**（非终止）——本表是 `API-02` 的**完整失败面**，生效版本以 §4 为准。

---

### 2.3 `API-03` 命令 `sonecheck.setApiKey`（VS Code 命令契约）

- **状态**：`[PLANNED]`
- **Path**：VS Code 命令 ID `sonecheck.setApiKey`
- **Method**：命令调用（无参）
- **归属 / 调用方**：`ui/commands` / 由用户手动触发
- **幂等性**：幂等（以最后一次写入为准）
- **返回语义**：Key 写入 SecretStorage（见 §3 `CFG-01`）；**任何情况下不得回显 Key 明文**（INV-03）

**失败面（Failure Face）**

| 错误码 | 场景 | 返回约定 | 是否静默 |
|--------|------|----------|----------|
| `ERR-10` | 用户取消输入 | 保持原值不变 | 是（无操作即无副作用） |
| `ERR-11` | 输入为空串 | 视为清除 Key，需二次确认 | 否 |

---

### 2.4 `reason_code` 取值枚举（`API-01` Response 字段）

> `reason_code` 由 `API-01` 的 `choice` 型 question 产出（见 §2.1）——本表的枚举值即该 question `criteria` 的 **key 集合**。
> 供 UI 清单条目展示与用户判断依据。
> **不在本表枚举内的取值视为 schema 不合规**，按 `ERR-05` 丢弃该块。

| 取值 | 含义 | 典型触发场景 | 生效版本 |
|------|------|--------------|----------|
| `AUTH_BOUNDARY` | 鉴权 / 权限边界变更 | Token 校验、角色判断、Session 逻辑、权限注解 | `v0.1.0` |
| `DATA_WRITE` | 数据写入 / 事务变更 | INSERT / UPDATE / DELETE、事务边界、金额字段 | `v0.1.0` |
| `CONTRACT_BREAK` | 对外接口或 Schema 破坏性变更 | 函数签名、REST / RPC 字段、数据表结构变更 | `v0.1.0` |
| `ERROR_HANDLING` | 异常处理 / 重试逻辑变更 | 删除 try-catch、改重试退避、吞掉错误 | `v0.1.0` |
| `CONFIG_CHANGE` | 配置或密钥相关变更 | 环境变量、超时值、连接池、密钥读取方式 | `v0.2.0` |
| `HIGH_FANOUT` | 高引用数符号变更 | 导出函数 / 公共类型被多个调用方引用 | `v0.2.0` |
| `STYLE_ONLY` | 纯样式 / 注释 / 格式化 | 空行、引号、注释、文档字符串（预期得低分） | `v0.1.0` |

- **生效版本**：`v0.1.0`（本地 mock）与 `v0.1.1`（真实判定服务）**都只产出 5 项**——`CONFIG_CHANGE` / `HIGH_FANOUT` 需配置解析与引用计数能力（`local_metadata.caller_count`），归 `v0.2.0`（见 `200-spec` §1.1 与 `05` §2.2 的顺延登记）。请求侧 `criteria` 只发送这 5 项，模型不可能返回枚举外取值。本表为**完整枚举集合**，未生效项仍属合规取值，仅当前实现不会产出。
- **单值返回**：一个 hunk 命中多个维度时，返回**影响面最大**的一个；`reason_code` 不支持多值。
- **新增取值**属纯增量：须在本表登记并回写编号（见 §5）。

---

## 3. 存储 Schema

**`CFG-01` 配置项与密钥存储**（状态 `[CURRENT]`）

- **生效版本**：`v0.1.0` 兑现 4 项 workspace 配置；`sonecheck.jevApiKey`（SecretStorage 行）与 `sonecheck.endpoint`（`ADR-007` 纯增量）随 `v0.1.1` 落地。
- **默认值依据**：`riskThreshold` 默认值由 S2 Harness 实测回填（mock 分布：规模噪声地板 `0.20`、语义命中自 `0.40` 起；阈值取噪声地板的 2.0 倍）。**S3 真实端点复核（24 块跨来源样本）**：真实 `noul` 分布同样**双峰**——低峰 `0.03`–`0.19`（14 块）、高峰 `0.42`–`0.97`（10 块），**`0.2`–`0.4` 为谷**；`0.4` 正落在谷的高侧，语义命中必 `AUDIT` 的验收场景成立 → **维持 0.4 不调**。是否可下调到谷底（≈0.3）需**带标签样本**判定（当前样本无标签，无法区分假阴 / 假阳），列为遗留项

| 实体 | 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|------|
| VS Code SecretStorage | `sonecheck.jevApiKey` | `string` | 仅存于 OS 级密钥库；禁止落盘明文 | 违反即 INV-03（**`v0.1.1`**） |
| workspace 配置 | `sonecheck.riskThreshold` | `number` | `0.0 < v < 1.0`，默认 `0.4`（S3 实测回填） | 命中即计入清单 |
| workspace 配置 | `sonecheck.maxItems` | `number` | `1 ≤ v ≤ 20`，默认 `3` | 清单条数上限（Top-K） |
| workspace 配置 | `sonecheck.enabled` | `boolean` | 默认 `true` | 全局开关 |
| workspace 配置 | `sonecheck.sensitivePathPatterns` | `string[]` | 默认含 `auth` / `payment` / `migration` 等 | 供 `local_metadata.touches_sensitive_path` 使用 |
| workspace 配置 | `sonecheck.endpoint` | `string` | 须为 https URL；默认官方判定端点（`ADR-007`） | 判定服务端点；测试 / 自托管网关覆盖 |

- **迁移策略**：配置项只做**纯增量追加**；重命名或语义变更必须走 `dm-adr` 并提供默认值回退，禁止静默变更含义。

---

## 4. 错误码总表

| 错误码 | 状态 | 含义 | 级别 | 处理建议 | 生效版本 | 可执行验证 |
|--------|------|------|------|----------|----------|-----------|
| `ERR-01` | `[CURRENT]` | 网络不可达 | WARN | 降级放行 + 一次性提示（INV-04） | `v0.1.1` | T2 契约测试：注入 `disconnect`（Node 端真断连）→ 断言 `failure = ERR-01` 且不抛错 |
| `ERR-02` | `[CURRENT]` | 请求超时 | WARN | 降级放行 + 一次性提示（INV-04） | `v0.1.1` | T2 契约测试：注入 `timeout`（挂起 3s）→ 断言约 500ms 放弃、`failure = ERR-02`、不重试 |
| `ERR-03` | `[CURRENT]` | 非 2xx 响应 | WARN | 降级放行，日志记录状态码 | `v0.1.1` | T2 契约测试：注入 `http500` → 断言 `failure = ERR-03` 且不重试 |
| `ERR-04` | `[CURRENT]` | 配额耗尽 / 鉴权失败（`401` Key 错误 / `403` 未带 Key 头 / `429` / `529`） | ERROR | 降级放行 + 引导检查 API Key；仅 `429` / `529` 重试 | `v0.1.1` | T2 契约测试（仿真端点注入 `unauthorized` / `forbidden` / `rate429` / `rate529`）：断言 `401` / `403` 不重试、`429` / `529` 退避次数 ≤ 上限且最终降级 |
| `ERR-05` | `[CURRENT]` | 请求不合规（`400` / `422`）或响应 schema 不合规 | ERROR | 丢弃该块，写入日志，不进入清单 | `v0.1.1` | T1 + T2：请求侧未知 `type` → `400`、`choice` 缺 `criteria` → `422`（经 `/stats.lastRequest` 断言实发请求体）；响应侧缺字段 / 越界 / 枚举外取值各一例 → 断言该块被丢弃、其余块保留 |
| `ERR-06` | `[CURRENT]` | 非 git 仓库 | WARN | 提示一次并终止 | `v0.1.0` | 单测：`test/git.test.ts` 断言非仓库目录抛出分类失败 `ERR-06` |
| `ERR-07` | `[CURRENT]` | 暂存区无改动 | INFO | 提示一次「无暂存改动」 | `v0.1.0` | 单测：`test/riskEngine.test.ts` 断言空 diff 抛出分类失败 `ERR-07` |
| `ERR-08` | `[PLANNED]` | API Key 未配置（`API-02` 前置校验；宽限跳过语义，`ADR-006`） | WARN | 首次：一次性引导（带「设置 Key」按钮直达 `sonecheck.setApiKey`）；检查静默跳过（视为放行）；后续仅状态栏短暂提示 | `v0.1.1` | 单测：密钥可读性为 `false` → 断言不进入判定、产生一次性引导且状态非错误 |
| `ERR-09` | `[CURRENT]` | git 可执行文件缺失 | ERROR | 提示一次并终止 | `v0.1.0` | 单测：`test/git.test.ts` / `src/infra/git.ts` 的 `ENOENT` 分类分支（真机不可复现，以代码分支 + 分类断言为准） |
| `ERR-10` | `[PLANNED]` | 用户取消输入（`API-03`） | INFO | 忽略，保持原值 | `v0.1.1` | 真机验证（原生输入框不可在纯 Node 复现）：取消后原值不变 |
| `ERR-11` | `[PLANNED]` | 输入为空串（清除 Key，`API-03`） | WARN | 二次确认后清除 | `v0.1.1` | 单测：二次确认布尔为 `false` → 断言保留原值；真机验证确认路径 |

- **生效版本**：`v0.1.0` 只落地 `ERR-06` / `ERR-07` / `ERR-09`（本地失败路径，不依赖网络与密钥）；`ERR-01`~`ERR-05` 随真实判定服务在 `v0.1.1` 落地（对契约仿真端点验收，`ADR-007`），`ERR-08`（归 `API-02`，宽限语义 `ADR-006`）与 `ERR-10` / `ERR-11`（归 `API-03`）同版落地。本表为**完整错误码集合**，未生效项仍属合规返回值，仅当前实现不会产出。
- **状态翻牌**：错误码状态与其 `生效版本` 同步——对应版本 S3 实测回填后由 `[PLANNED]` 翻 `[CURRENT]`；未生效项保持 `[PLANNED]`（`dev-meta/docs/06` §4.2）。

---

## 5. 契约演进治理

- **破坏性变更**（改语义 / 签名 / 坐标口径）：须走 `dm-adr` 记录并同步调用方，**不得静默修改**。
- **纯增量追加**：标注「纯增量」并回写编号至本表（如 §2.4 新增 `reason_code` 取值）。
- **状态翻牌**：`[PLANNED]` → `[CURRENT]` **须以可执行证据为前提，分两批进行**——S3 翻有实测 / 单测 / 守卫依据者（本版为 `INV-02` / `INV-07` / `API-01`（签名与本地派生）/ `CFG-01`），其余兑现项（`INV-01` / `INV-05` / `INV-06` / `API-02` / `ERR-06` / `ERR-07` / `ERR-09`）随 S6 守卫与单测全绿后翻牌；被取代 / 废弃 → 标 `[HISTORY]` 并迁归档，索引保留一行 + 归档指针，**不删除**（`dev-meta/docs/06` §4.2 / §6.5）。
- **引用单向**：本文**只被引用，不引用下游**（版本文档 / 计划 / 上层规格）；消费方在**自己文档内**声明引用（`dev-meta/docs/06` §7.1）。
- **只读纪律**：AI 严禁自行改写契约本身；改实现前先 diff 契约（见 `dev-meta/docs/06` §8 与 `dm-contract-gate`）。

---

## 6. 引用声明

| 引用对象 | 方向 | 用途 |
|----------|------|------|
| `00_PRODUCT_REQUIREMENTS.md` | upstream | 业务意图与可用性要求 |
| `01_TECHNICAL_SPEC.md` | upstream | 技术选型与约束 |
| `02_SYSTEM_DESIGN.md` | upstream | 架构与数据流 |
| `dev-meta/docs/06-contract-based-dev.md` | 外部权威 | 契约规范：§4 记录 / §4.2 状态 / §6 组织与索引 / §7 引用纪律（只引用） |
| `docs/reference/jev-api.md` | 关联 | 上游 Jev API 的**全文参考快照**（2026-10-06）——只读查阅用；权威仍为官方文档（见 §2.1 上游规范） |

---

## 7. 组织与索引（超过规模阈值时启用）

> 单文件形态足以支撑「契约 **≤ 30 条**或 **≤ 300 行**」。超过任一阈值，或**查一条契约需要全量读整份文档**时，按下述目录形态拆分（`dev-meta/docs/06` §6.1 / §6.2）。

**规模现状与豁免登记（2026-09-22）**

| 判据 | 当前值 | 状态 |
|------|--------|------|
| 契约条数 ≤ 30 | 22 条 | ✅ 未超 |
| 文件行数 ≤ 300 | 367 行（2026-10-06 复核） | ⚠️ **超限** |

- **本轮决定**：**登记豁免、暂不拆分**。理由：拆分须先冻结编号集合，再脚本批量改全仓引用并跑结构 lint（`dev-meta/docs/06` §6.8），属独立议题；与语义修订混做会放大引用断裂风险。
- **语义锚点同步延后**：契约条目注入锚点属拆分迁移序列中的一步（§7.3），随拆分一并执行；当前仅 §1 保留 `INV-02` 的形态示范。
- **复评触发条件**（满足任一即启动本节拆分）：① 契约条数 > 30；② 文件行数 > 400；③ 新增一个域；④ 出现「查一条契约需全量读整份文档」的实例。

### 7.1 目录结构

```text
docs/
├── 00_CONTRACTS.md        # 索引门面：只放「编号 | 一句话 | 状态 | 正文链接」，不含正文（≤150 行）
└── contracts/             # 契约正文唯一权威目录
    ├── 01-core.md         # 按域聚合（域前缀相同的契约同文件），单文件 ≤200 行
    └── 02-integration.md
```

**域 → 文件 → 锚点前缀映射表**（先定表，再动手；放索引门面内）

| 域文件 | 承载域（编号前缀） | 锚点前缀 |
|--------|-------------------|----------|
| `01-core.md` | `INV` / `ERR` | `inv-` / `err-` |
| `02-integration.md` | `API` / `CFG` | `api-` / `cfg-` |

- **一文件可承载多域**（按「读者一次要查完的范围」合并，不按前缀数量 1:1 机械拆）。
- **锚点前缀 = 域前缀 kebab 化**（`API-03` → `api-…`）；**文件序号即阅读顺序**，一经分配不复用。
- 权威：`dev-meta/docs/06` §6.2。

### 7.2 索引表范式

| 编号 | 一句话 | 状态 | 正文 |
|------|--------|------|------|
| `INV-02` | 出站 payload 不得含完整源文件 | `[CURRENT]` | `docs/contracts/01-core.md#inv-no-full-source-egress` |

### 7.3 拆分纪律

- **只搬不重编**：契约编号不变、正文逐字搬迁 —— 编号一变，全仓引用即断。
- 引用改造**必须脚本批量 + `grep` 复核**，禁止手改。
- 迁移顺序（每步可独立提交 / 回滚）：立索引 → 补状态标记 → 补语义锚点 → 接结构 lint → 物理拆分（`dev-meta/docs/06` §6.7）。
- 拆分后跑结构 lint：`python3 contract_lint.py --contracts-dir docs/contracts`（`dev-meta/docs/06` §8.4，参考实现 `samples/contract-lint/`）。

### 7.4 归档

过时契约标 `[HISTORY]` 并 `git mv` 迁入 `docs/archive/contracts/`，索引保留一行 + 归档指针，**不删除**；解释「为什么」的决策理由**不归档**，留在正文（`dev-meta/docs/06` §6.5）。

### 7.5 拆分执行与验收

前置、4 步操作、5 项验收判据与「不拆红线」的完整定义见 `dev-meta/docs/06` **§6.8**（含编号集合冻结命令与 lint 复跑命令）。摘要：

- **步骤**：冻结编号集合 → 先定映射表再按域切（未覆盖段落**报错中止**）→ 补锚点与状态、索引重写 → 批量改引用 + 复跑 lint。
- **验收 5 项**：编号零丢失 ｜ 正文逐字一致 ｜ 索引 ≤150 行、域文件 ≤200 行 ｜ 结构 lint 全绿 ｜ 旧引用形态清零。
- **红线**：不为整齐而拆；不夹带语义修订；不搬版本文档四件套与决策理由；不重编号。

### 7.6 域分类与命名

> 本项目已定域表：`INV`（业务不可变式）、`API`（命令与出站接口）、`CFG`（配置与密钥）、`ERR`（失败面）、`OBS`（观测）。完整参考与硬规则见 `dev-meta/docs/06` **§6.3**。

| 域 | 管什么 | 本项目已用编号 |
|----|--------|----------------|
| `INV` | 业务不可变式 | `INV-01` ~ `INV-07` |
| `API` | 接口签名 / 错误码 / 兼容性 | `API-01` ~ `API-03` |
| `CFG` | 配置项与密钥存储 | `CFG-01` |
| `ERR` | 失败面（跨模块） | `ERR-01` ~ `ERR-11` |
| `OBS` | 观测 / 日志 | 暂无（实例化见 `06_OBSERVABILITY.md`） |

- **硬规则**：全大写、无连字符无数字、**2–8 字符**、**一词一域**、**登记后不改名**（改名＝引用断，要拆就新立域 + 旧域归档）、不得占用 `S0–S7` / `GUARD-xx` / `L1–L3` 保留空间。
- **域选取**：按归属模块（改它时最先要跟着改的是谁）；跨模块关注点（错误 / 观测 / 并发 / 内存）**独立成域**；**一条契约只落一个域**。
- **锚点前缀 = 域前缀 kebab 化**（`API-03` → `api-…`）。

---

## 附录 A：通用域族参考（可裁剪）

> 规则权威见 `dev-meta/docs/06-contract-based-dev.md` §6.3；本附录只提供**可裁剪的域族清单**（源自 dev-meta 的 `06` §6.3 B 节）。

| 族 | 典型域前缀 | 管什么 |
|----|-----------|--------|
| 数据与不变量 | `DATA` `INV` `SCHEMA` | 数据结构、不可变式、存储 Schema、迁移 |
| 接口与协议 | `API` `EVT` `PROTO` `AUTH` | 接口签名、错误码、事件、鉴权、兼容性 |
| 处理与算法 | `ALGO` `PIPE` `CALC` `COORD` | 算法、管线编排、单位 / 坐标口径 |
| 表现与输出 | `UI` `RENDER` `EXPORT` `I18N` | 渲染、导出、下游消费、本地化 |
| 运行时与保障 | `MEM` `PERF` `CONC` `ERR` `OBS` `RES` `CFG` | 内存、性能、并发、错误面、可观测、资源、配置 |

## 附录 B：域命名反例清单（勿复现）

> 源自 dev-meta 的 `06` §6.3 E 节；判据依据见 `dev-meta/docs/06-contract-based-dev.md` §6.3 A/B/C。

| 反例 | 问题 |
|------|------|
| `RENDER` 已登记，却又写 `RENDERING-001` | 同一含义两种写法 —— 一词一域被破坏 |
| `MEM-001` 与 `MEMORY-001` 并存 | 同义双域 |
| `RENDER_001` / `RENDER-2-001` | 非法形态（下划线 / 双数字段） |
| 同一域同时管接口与权限 | 语义重叠 —— 应按 `dev-meta/docs/06-contract-based-dev.md` §6.3 A.2 拆为 `API` / `AUTH` |
| 用 `L4-001` / `GUARD-11` 当契约 ID | 占用保留命名空间（见 `dev-meta/docs/06-contract-based-dev.md` §6.3 C） |
