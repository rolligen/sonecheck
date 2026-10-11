# sonecheck - 技术规格

> **文档流向纪律**：本文档继承引用 upstream `00_PRODUCT_REQUIREMENTS.md`；**不引用下游，也不声明下游引用方**（引用方向严格单向）。
> **占位符约定**：`{{FIELD}}` = 结构化命名字段；`<!-- TODO: [dm-init-docs] <说明> -->` = 待补充内容。
> **权威引用**：测试职责分层见 `dev-meta/docs/06-contract-based-dev.md` §10（唯一权威），本文只做项目落地，不重定义。

---

## 1. 技术选型

| 层面 | 选型 | 版本 | 选型理由 / 决策记录 |
|------|------|------|---------------------|
| 语言 / 运行时 | TypeScript + Node.js | TypeScript `~5.7.0`；Node 22.x（VS Code 内置运行时，`@types/node` 固定 `^22.0.0`） | 与 VS Code Extension API 同源，零额外分发成本；**类型定义大版本必须与运行时一致**——`@types/node` 用更高大版本会允许调用宿主不存在的 API，编译通过但运行期失败；TypeScript 迁移决策见 [`adrs/adr-001.md`](adrs/adr-001.md) |
| 框架 | VS Code Extension API（无 Webview 框架） | VS Code 稳定版 | 原生 QuickPick / 状态栏足以覆盖 0.1.x 交互，避免 Webview 调试开销 |
| 存储 | VS Code `SecretStorage`（Key）+ `workspace.getConfiguration`（阈值、开关） | — | Key 不落盘明文；配置跟随用户设置同步 |
| 第三方服务 | Jev Decision API（TypeSafe AI） | `POST https://api.typesafe.ai/v1/systemone`；`model: "jev-1.13.0"`（**固定版本 ID**，不用浮动别名；官方文档 `https://docs.typesafe.ai/api`，全文参考快照见 `docs/reference/jev-api.md`） | System-1 结构化判定（`noul` / `choice` / `score` 三原语），输出免费、延迟量级为亚秒级；是本产品的成本与速度前提，实际延迟须经 M1 实测回填 |
| 构建 / 打包 | `@vscode/vsce` → `.vsix` | `^4.0` | 官方打包链，支持 GitHub Release 与 Marketplace 双通道 |
| 测试框架 | Vitest（T1 / T2）+ 契约仿真端点（T2 发真 HTTP）；T3 走真机人工 | `vitest ^5.0` | 纯 Node 场景零配置跑 TS；T2 对**契约仿真端点发真 HTTP**而非 HTTP 层拦截，使传输层故障（真断连）与上游侧观测量（重试次数、并发峰值）真实可得，且与真机验收共用同一份端点实现。决策见 [`adrs/adr-003.md`](adrs/adr-003.md)（框架与 T1 Mock 分层）、[`adrs/adr-008.md`](adrs/adr-008.md)（T2 弃用 MSW 改真 HTTP） |

> 架构级技术选型须经 `dm-adr` 记录决策（ADR），本文只登记结论与指向。

---

## 2. 边界约束

| 约束类型 | 内容 | 来源 |
|----------|------|------|
| 平台 / 环境 | 目标平台 VS Code 稳定版（最低 `^1.90.0`，以 `extension/package.json` 的 `engines.vscode` 为准）；宿主为扩展宿主进程（Extension Host）；必须在 macOS / Windows / Linux 三端可用 | 00 §3 兼容性 |
| 资源上限 | 单次检查端到端 p95 ≤ 1s；单块判定 ≤ 500ms；上传 payload 单块 ≤ 2KB（2048 字节）；检查期间不得阻塞 UI 线程 | 00 §3 性能；payload 上限为本文在「绝不上传全量源文件」之下新增的工程上限 |
| 依赖限制 | 禁止上传全量源文件；禁止在日志 / 遥测中出现 API Key 与源码明文；禁止以任何形式修改用户工作区文件（只读）；运行期**零新增第三方依赖**（仅用 Node / VS Code 原生能力，第三方能力限制在 `devDependencies`） | 00 §3 安全、00 §5 非目标；零新增依赖见 [`adrs/adr-004.md`](adrs/adr-004.md) |
| 网络 | 无网络 / Jev 不可用时必须降级放行，不阻断提交 | 00 §3 可用性 |
| 隐私 | BYOK（用户自备 Jev API Key）为版本群既定模式，**`v0.1.1` 起启用**；`v0.1.0` 不涉及 API Key（`API-03` 归 `v0.1.1`）。不引入服务端中转——**该约束在 `v0.1.x` 期间有效，`v1.0.0` 起随 `00` §5 同步解除** | 00 §5 非目标 |
| 依赖版本对齐 | `@types/node` 大版本必须等于扩展宿主内置的 Node 运行时大版本（当前 `^22.0.0`）；TypeScript 锁 5.x 稳定代际（`~5.7.0`） | 工程基线（宿主为 Extension Host + Node 22.x） |

---

## 3. 测试策略

> **只做项目落地，不重定义分层**：测试职责分层的唯一权威是 `dev-meta/docs/06-contract-based-dev.md` §10（design=场景 / build=行为契约 / dm-dev-step=落地，互不重定义）。

| 测试层 | 覆盖范围 | 运行方式 | 门禁要求 |
|--------|----------|----------|----------|
| 单元 / 断言（T1） | diff 解析、上下文截取、判定打分、阈值过滤与 Top-K、配置归一、错误码映射、Key 读写、报告与并发编排 | `npm run test:unit`（Vitest，纯 Node） | 全绿方可交付 |
| 契约 / 集成（T2） | Jev 请求 / 响应 schema、降级路径（`ERR-01`~`ERR-05`）、重试与超时、Key 泄漏断言、上游侧并发峰值与端到端预算 | `npm run test:integration`（Vitest + **对 `tools/jev-mock/` 发真 HTTP**） | 全绿方可交付 |
| 端到端 / 真机（T3） | 「触发命令 → 清单弹出 → 点击跳转」完整链路；断网降级全谱 | 手动安装 `.vsix` 真机验证 | 核心路径零走查 |

> **T2 与 T3 共用同一端点**：`tools/jev-mock/handler.mjs` 是`03` §2.1 的可执行镜像，Node 入口供 T2 与真机验收共用，Worker 入口供部署用。两者打的是同一份 handler，行为不可能漂移——这是「T2 不假绿」的结构性保证（[`adrs/adr-008.md`](adrs/adr-008.md)）。

> **层级说明**：本表定义各测试层的**职责范围**（T1 行为 6 项职责面）；每个版本**实际覆盖哪几项、用例数多少**由该版本文档承载，不在本文重复。
>
> **命令口径**：T1 门禁用 `npm run test:unit`，T2 门禁用 `npm run test:integration`（随真实客户端落地）；`npm run test` 为两者聚合别名。

> ⚠️ **编号约定**：`L1 / L2 / L3` 专属于**契约层级**（接口 / Feature / 行为，见 `dev-meta/docs/06`）。
> 测试层级此处用 `T1 / T2 / T3`，避免同号不同义。

- **AI 生成测试的硬约束**：须断言具体边界值（空输入 / 极值 / 越界），禁止无断言的假 Green（见 `dev-meta/docs/06` §5 失败面契约）。
- **不写 TDD 的范围**：QuickPick / 状态栏等原生 UI 呈现层（VS Code 原生控件、无逻辑分支），以 T3 真机验证替代；原因：组件无法在纯 Node 环境复现。
- **判定服务的 Mock 分层**（`infra/jevClient` 的测试策略，`v0.1.1` 接入真实客户端前即按此设计）：
  - **T1（单元）——依赖注入**：`core` 依赖 `IJevClient` 抽象而非具体实现，测试注入内存 stub。毫秒级、无网络，覆盖切块 / 打分 / 过滤 / 排序等纯逻辑。接口隔离决策见 [`adrs/adr-002.md`](adrs/adr-002.md)。
  - **T2（契约 / 集成）——真HTTP 打契约仿真端点**：保留客户端**全部**逻辑（Header 拼装、超时计时、`429` / `529` 重试与退避），对 `tools/jev-mock/` 发真实 HTTP，验证 `401` / `403` / `422` / `429` / `529` 与真断连各自的降级表现；重试次数与并发峰值从端点 `/stats` 取证。
  - **红线**：T1 中不得 mock 掉退避与超时——那属 T2 覆盖范围，在 T1 里「测过」等于没测。同理 T2 不得用 HTTP 层拦截把传输层故障「近似」成构造响应（`ERR-01` 必须是真断连，见 [`adrs/adr-008.md`](adrs/adr-008.md)）。

> **MSW 已弃用**：原 T2 走 MSW HTTP 层拦截（`adr-003`），`v0.1.1` 落地时改为真 HTTP 打契约仿真端点，MSW 已从 `devDependencies` 移除。见 [`adrs/adr-008.md`](adrs/adr-008.md)。

---

## 4. 部署基线

| 项 | 内容 |
|----|------|
| 目标环境 | 开发者本机 VS Code（开发态：Extension Development Host） |
| 构建命令 | `npm run compile`（tsc）+ `npx @vscode/vsce package`；`extension/package.json` 的 `scripts` 与 `tsconfig.json` 已随 `v0.1.0` 脚手架落盘并持续使用 |
| 发布方式 | 双通道：① GitHub Release 附带 `.vsix`；② VS Code Marketplace 发布（Publisher `rolligen`，清单见 `extension/package.json`）。**② 当前待 `VSCE_PAT` 到位，尚未上架**；① 已随 `v0.1.0` / `v0.1.1` 收口产出 `.vsix` |
| 回滚方式 | Marketplace 侧发布新版本覆盖；GitHub 侧删除 Release 资产或回退 tag |
| 配置与密钥 | Jev API Key 经 VS Code SecretStorage 存储；阈值 / 开关经 `workspace.getConfiguration("sonecheck")`；仓库内**禁止**出现任何真实 Key |
| npm 占位包 | 仓库根的 `sonecheck` 占位包已发布（`publishConfig.access: public`），**冻结于 `0.0.x`**，不再演进 |
| VS Code 扩展 | 位于 `extension/`，持有独立 `package.json`（`publisher: rolligen`）；版本独立编号，自 `0.0.1` 起，`v0.1.0` 为 MVP 主线；与根目录 npm 占位包**互不共用** `name` / `version` 字段 |

---

## 5. 引用声明

| 引用对象 | 方向 | 用途 |
|----------|------|------|
| `00_PRODUCT_REQUIREMENTS.md` | upstream | 业务意图来源（§2 平台 / 资源 / 依赖 / 网络 / 隐私约束） |
| `dev-meta/docs/06-contract-based-dev.md` §10 | 外部权威 | 测试职责分层（只引用） |
| `docs/adrs/adr-001.md` | 关联 | 语言 / 运行时与工程布局（§1） |
| `docs/adrs/adr-002.md` | 关联 | 判定器接口隔离与 T1 依赖注入（§3） |
| `docs/adrs/adr-003.md` | 关联 | 测试框架与 Mock 分层（§1、§3） |
| `docs/adrs/adr-004.md` | 关联 | Jev 客户端手写 `fetch`、运行期零新增依赖（§2） |
| `docs/adrs/adr-008.md` | 关联 | T2 弃用 MSW、改对契约仿真端点发真 HTTP（§1、§3） |

> 方向取值：`upstream`（本文引用它）/ `外部权威`（只引用不重定义）/ `关联`（无层级关系的互补文档）。
> **不引下游**：契约编号（`INV-*` / `API-*` / `CFG-*` / `ERR-*`）与版本文档章节一律不在本文出现；契约 / 版本侧如需引用本文，在其自身文档内登记。
