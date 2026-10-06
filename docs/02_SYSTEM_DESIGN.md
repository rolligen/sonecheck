# sonecheck - 系统设计

> **文档流向纪律**：本文档继承引用 upstream `00_PRODUCT_REQUIREMENTS.md`、`01_TECHNICAL_SPEC.md`；**不引用下游，也不声明下游引用方**（引用方向严格单向）。
> **占位符约定**：`{{FIELD}}` = 结构化命名字段；`<!-- TODO: [dm-init-docs] <说明> -->` = 待补充内容。
> **权威引用**：可观测性规范见 `dev-meta/docs/07-observability-driven-dev.md`（唯一权威），本文**只放指针**；架构设计原则见 `dev-meta/docs/09-ai-architecture-guide.md`。

---

## 1. 总体架构

```
[ VS Code UI 层 ]  commands / QuickPick / 状态栏 / 通知
          │  只依赖 core 的 Facade
          ▼
[ Core 决策层 ]  riskEngine：切块编排 → 上下文组装 → 并发判定 → 阈值过滤 → Top-K
          │  只依赖 infra 的 Facade
          ▼
[ Infra 基础设施层 ]  git 读取 / 源文件读取 / diff 解析 / Jev HTTP 客户端 / SecretStorage / 结构化日志
          │
          ▼
[ 外部 ]  git CLI  ·  Jev Decision API
```

**分层原则**：严格单向分层 `UI → Core → Infra`。上层可依赖下层，下层**不得反向依赖**；跨层只经 Facade（`src/core/index.ts` / `src/infra/index.ts`）暴露，内部实现私有。UI 层不得直接调用 git 或 HTTP；Core 层不得直接操作 VS Code API（除通过 infra 注入的能力）。

**跨层常量**：`src/constants.ts` 集中全部命名常量（判定阈值、payload 上限、构建期日志开关等），是**纯数据模块**——不属于任何层、不 import 任何层，三层均可只读引用；禁止在判定逻辑或各模块内散落字面量。

| 层 | 职责 | 可依赖 | 禁止 |
|----|------|--------|------|
| UI（`src/ui`） | 命令注册、风险清单展示、跳转、状态提示 | `core` Facade；配置读取经 `infra` Facade（`configSource`） | 直接调 git / HTTP / 文件系统；import `infra` 内部实现（绕过 Facade） |
| Core（`src/core`） | 切块编排、上下文组装、并发调度、阈值过滤、Top-K | `infra` Facade | 引用 `vscode` 模块做 IO、直接发网络请求 |
| Infra（`src/infra`） | git diff 读取、diff 解析、Jev 客户端、密钥存储、日志 | Node / VS Code 基础 API | 反向 import 上层模块 |

---

## 2. 组件与模块划分

| 模块 | 职责 | 对外暴露（Facade / API） | 内部实现 |
|------|------|--------------------------|----------|
| `src/extension.ts` | 激活入口，仅做装配与命令注册（依赖实现由此处注入） | `activate()` / `deactivate()` | 私有 |
| `src/constants.ts` | 命名常量唯一集中处（判定阈值、payload 上限、构建期日志开关），纯数据无依赖 | 常量（只读） | 无逻辑 |
| `src/ui/commands.ts` | 命令编排：读取配置 → 调 core → 分发结果给展示层 | `registerCommands()` | 私有 |
| `src/ui/riskList.ts` | QuickPick 风险清单 + 条目跳转定位 | `showRiskList()` | 私有 |
| `src/ui/status.ts` | 状态栏与一次性提示（All Clear / 降级提示） | `reportStatus()` | 私有 |
| `src/core/riskEngine.ts` | 主流程：切块 → 组装 payload → 并发判定 → 过滤 → Top-K | `inspect()` | 私有 |
| `src/core/contextBuilder.ts` | 为每个 hunk 补上下文行，控制 payload ≤ 2KB | `buildContext()` | 私有 |
| `src/core/threshold.ts` | 阈值判定与排序（RISK_THRESHOLD 常量，禁魔数） | `filterRisky()` | 私有 |
| `src/core/config.ts` | 配置模型与校验：校验阈值范围、归一默认值（纯逻辑，**不接触 VS Code API**） | `normalizeConfig()` | 私有 |
| `src/infra/configSource.ts` | 从 `workspace.getConfiguration` 读取原始 workspace 配置（唯一接触 VS Code 配置 API 的出口；**密钥不归本模块**） | `readRawConfig()` | 私有 |
| `src/infra/git.ts` | 取工作区根、执行 `git diff --staged`（含本地失败分类：`ERR-06` / `ERR-09`） | `resolveRepoRoot()` / `readStagedDiff()` | 私有 |
| `src/infra/sourceReader.ts` | 只读读取工作区源文件行（供上下文截断；文件缺失返回空数组） | `readSourceLines()` | 私有 |
| `src/infra/diffParser.ts` | diff 文本 → hunk 数组（文件、起始行、变更类型、内容；超长 hunk 按 payload 上限切分） | `parseDiff()` | 私有 |
| `src/infra/jevClient.ts` | Jev 决策请求（超时、重试、错误归一：上游状态码 → 契约错误码的唯一映射处） | `IJevClient` / `decide()` | 私有 |
| `src/infra/secrets.ts` | API Key 读写的**唯一出口**（VS Code SecretStorage；`INV-03`） | `hasApiKey()` / `getApiKey()` / `setApiKey()` / `clearApiKey()` | 私有 |
| `src/infra/logger.ts` | `observe()` 包装器 + Output Channel 输出 | `observe()` / `log(event)` | 私有 |

> **极简暴露**：每模块仅经统一 Facade / 入口文件对外暴露，内部实现全部私有（见 `dev-meta/docs/09-ai-architecture-guide.md` §2）。
> **判定服务抽象**：`core` 只依赖经 `src/infra/index.ts` 导出的 `IJevClient` 抽象，**禁止 import `infra/jevClient` 具体路径**；具体实现由装配层 `src/extension.ts` 在激活时注入，测试注入内存 stub 替换。
> **错误码映射归属**：上游状态码 → 契约错误码的映射**唯一归属** `infra/jevClient`（错误归一）；`core` 与 `ui` 不得各自维护映射表，`ui` 只按已归一结果提示。
> **密钥边界**：SecretStorage 只由 `infra/secrets` 接触；`configSource` 只读 workspace 配置；Key 明文不得出现在其他任何模块（`INV-03`，守卫 `GUARD-06`）。

---

## 3. 数据流 / 调用链

主链路（手动触发检查）：

| 步骤 | 发起方 | 接收方 | 数据 | 通信方式 |
|------|--------|--------|------|----------|
| 1 | 用户 | `ui/commands` | 触发命令 `sonecheck.inspectDiff` | 同步（VS Code 命令） |
| 2 | `ui/commands` | `infra/configSource` | 读取原始配置与密钥可用性 | 同步（VS Code API） |
| 3 | `ui/commands` | `core/config` | 归一为 `SoneCheckConfig` | 同步（纯函数） |
| 4 | `ui/commands` | `core/riskEngine` | 传入已归一配置，调用 `inspect(config)` | 同步（进程内） |
| 5 | `core/riskEngine` | `infra/git` | 工作区根路径 | 同步（child_process） |
| 6 | `infra/git` | `core/riskEngine` | 暂存区 diff 原始文本 | 同步（返回字符串） |
| 7 | `core/riskEngine` | `infra/diffParser` | diff 文本 | 同步（纯函数） |
| 8 | `core/riskEngine` | `core/contextBuilder` | 每个 hunk 补上下文行（单块 payload 硬上限 2048 字节） | 同步（纯函数） |
| 9 | `core/riskEngine` | `infra/jevClient` | hunk payload 数组（并发上限 4） | 异步（HTTP，批量并发） |
| 10 | `core/riskEngine` | `core/threshold` | 判定结果数组 | 同步（纯函数） |
| 11 | `ui/commands` | `ui/riskList` / `ui/status` | Top-K 风险项 或 空集 | 同步（原生控件） |
| 12 | `ui/riskList` | VS Code 编辑器 | 打开文件 + 定位行列 | 同步（VS Code API） |

> **跨模块解耦**：同步用 Facade 调用，异步（判定结果）用 Promise + 一次回传；禁止模块间硬编码互相引用（`dev-meta/docs/09-ai-architecture-guide.md` §3.2）。

**边界说明**：步骤 9 是唯一跨进程边界（网络），也是唯一可能引入秒级延迟的环节；步骤 5/12 是与本机 git / 编辑器的边界，均不得修改工作区内容。

---

## 4. 并发与状态机模型

| 状态 / 阶段 | 进入条件 | 下一状态（推进条件） | 失败面 |
|-------------|----------|----------------------|--------|
| `Idle` | 激活后初始态 / 上一次检查收尾 | `Collecting`（用户触发命令） | — |
| `Collecting` | 命令触发（前置校验 → 读配置并归一 → 执行 `git diff --staged` → 切块） | `Deciding`（配置与 hunk 数组均就绪） | **终止**（提示一次后回 `Idle`）：非 git 仓库 / git 不可用 / 暂存区无改动；**跳过**（宽限，见四分类）：API Key 未配置 |
| `Deciding` | 配置已归一、hunk 数组已就绪 | `Reporting`（全部 hunk 判定返回） | **降级**（一次性提示后回 `Idle`，按放行处理）：网络不可达 / 超时 / 非 2xx / 配额耗尽；**丢弃单块**（剔除该块，流程继续）：判定响应不合规 |
| `Reporting` | 判定完成 | `Idle`（清单关闭 / 选中条目 / 状态提示结束） | — |
| `Degraded` | 仅由 `Deciding` 的降级分支进入 | `Idle`（一次性提示结束） | — |

- **失败面四分类**（互不混用，须与契约失败面同口径）：

| 类别 | 触发条件 | 状态归属 | 用户可见表现 |
|------|----------|----------|--------------|
| **终止** | 本机环境前置校验失败（未产生任何判定） | 不进入 `Degraded`，自 `Collecting` 直接回 `Idle` | 一次性提示 |
| **跳过** | 判定前置条件缺失但非故障（API Key 未配置；`ADR-006`） | 不进入 `Deciding`，自 `Collecting` 直接回 `Idle` | 首次一次性引导（带「设置 Key」按钮）+ 后续状态栏瞬时；**不算失败、不算终止** |
| **降级** | 判定服务侧不可用（网络 / 超时 / 非 2xx / 配额） | `Deciding` → `Degraded` → `Idle` | 一次性提示 + 放行 |
| **丢弃单块** | 单块判定响应不合规 | 状态不变，整轮检查继续 | 无打扰（仅留痕） |

- **并发模型**：单次检查内 hunk 级并发（上限 4，避免触发对端限流）；同时对同一工作区只允许一个检查在飞（重复触发直接复用进行中的 Promise，不另起流程）。异步全程不占用编辑器主线程。
- **状态切换可观测**：关键状态切换须留痕。

---

## 5. 可观测性设计（仅指针）

> **不在此展开**：可观测性原则、黑匣子结构、包装器的唯一权威是 `dev-meta/docs/07-observability-driven-dev.md`。
> 本节只登记「哪些关键路径必须被观测」，**不声明其实现落点**——落点由下游文档自行声明（引用方向严格单向）。

| 关键路径 | 是否高开销 | 须含指标 |
|----------|-----------|----------|
| git diff 读取（`infra/git`） | 是（子进程） | Elapsed / 改动块数 / 是否为空 |
| Jev 判定（`infra/jevClient`） | 是（网络） | Elapsed / 请求块数 / 状态码 / 重试次数 |
| 阈值过滤与 Top-K（`core/threshold`） | 否 | 输入块数 / 命中块数 / 阈值取值 |
| 降级路径（`Degraded`） | 否 | 失败原因码 / 是否静默 |
| 跳转定位（`ui/riskList`） | 否 | 目标文件 / 行列 / 是否命中 |

---

## 6. 引用声明

| 引用对象 | 方向 | 用途 |
|----------|------|------|
| `00_PRODUCT_REQUIREMENTS.md` | upstream | 业务意图 |
| `01_TECHNICAL_SPEC.md` | upstream | 技术选型与约束 |
| `dev-meta/docs/07-observability-driven-dev.md` | 外部权威 | 可观测性规范（只引用） |
| `dev-meta/docs/09-ai-architecture-guide.md` | 外部权威 | 架构设计原则（只引用） |

> 方向取值：`upstream`（本文引用它）/ `外部权威`（只引用不重定义）/ `关联`（无层级关系的互补文档）。
