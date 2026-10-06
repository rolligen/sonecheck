# v0.1.1 特性规格 — honest-jev

> 结构唯一权威：`dev-meta/docs/02-version-rules.md` §4。
> ⚠️ 本文件不得出现 `Transaction Flow` / `TF` / `Step` 章节（施工拆分属 `400-build.md`）。

把 `infra/jevClient` 从本地 mock 换成**真实 HTTP 判定服务客户端**（`IJevClient` 签名零变更，ADR-002），任何网络失败都不阻断提交；hunk 级并发判定（上限 4）保证端到端 `p95 ≤ 1s`。受 Jev 注册暂停（2026-09-22）影响，本版验收与实测全部对**契约仿真端点**执行（ADR-007）——扩展侧代码一行不假，只差真实上游。

**本版本不包含**：运行期结构化日志（O2 埋点）、`local_metadata` 三字段、`CONFIG_CHANGE` / `HIGH_FANOUT` 两项 `reason_code`（以上顺延，由 roadmap 层在后续版本重排）、Marketplace 上架（待 `VSCE_PAT`，同 `v0.1.0` 收口口径）、真实端点校准（待 Jev Key 到位，`ADR-007` 显式挂账）。

---

## 1. 架构锚点（本版本触及的架构面）

| 维度 | 本版本触及 | 硬约束 / 红线 |
|---|---|---|
| 分层 | 不新增层；三层纪律延续 `v0.1.0` | 严格单向 `UI → Core → Infra`；`core` 不得引用 `vscode`；跨层只经 Facade |
| 模块 | **新建** `src/infra/secrets.ts`（SecretStorage 唯一出口）；**重写** `src/infra/jevClient.ts`（真实 HTTP 客户端，`v0.1.0` 的 `scoreHunk` mock 移入 `test/` 作 T1 fixture）；`core/riskEngine` 增并发编排（semaphore，上限 4）；`ui/commands` 增 `setApiKey` 与未配 Key 引导；`infra/configSource` / `core/config` 增 `endpoint` 归一；`src/constants.ts` 增量（超时 / 退避 / 并发上限 / 默认 endpoint） | Key 读取与写入只出现在 `infra/secrets.ts`（`INV-03`）；网络与重试逻辑只出现在 `infra/jevClient`；并发上限、超时等字面量只取自 `constants.ts`（`INV-07`） |
| 门面 | `src/core/index.ts` / `src/infra/index.ts` 不变，增量 re-export 新公开符号 | 层间调用只经 Facade |
| 契约 | 翻牌集合：`INV-04`、`API-01`（真实链路与失败面）、`API-03`、`ERR-01`~`ERR-05`、`ERR-08`（**语义变更**，`ADR-006`）、`ERR-10` / `ERR-11`；`CFG-01` **纯增量**追加 `sonecheck.endpoint`（`ADR-007`）。**是否阻塞编码：否**（`ERR-08` 语义与 endpoint 均已在开工前经 ADR 定案并回写 `03`） | 契约 ID 与 `03_CONTRACTS_AND_API.md` 完全一致；翻牌集合与 `05` §2.2 一致；`IJevClient` 公开签名不得变更（`ADR-002`） |
| API | 新增 VS Code 命令 `sonecheck.setApiKey`（`API-03`）；`API-02` 失败面补全（`ERR-08` 宽限态） | 命令 ID 与契约逐字一致；Key 任何情况下不回显明文（`INV-03`） |

### 1.1 明确不做（技术 / 范围）

| 项 | 类型 | 理由 / 归属 |
|---|---|---|
| 运行期结构化日志（`observe` / `inspectionId` / 7 个埋点） | 范围 | 随范围裁剪顺延——与核心场景「mock 换真身」无耦合，由 roadmap 层在后续版本（预计 `v0.2.0`）重排；`06` §6 为版本无关的能力演进，无需改动 |
| `local_metadata` 三字段 | 范围 | 同上顺延；`touches_sensitive_path` 沿用 `v0.1.0` 的本地路径判定 |
| `CONFIG_CHANGE` / `HIGH_FANOUT` 两项 `reason_code` | 范围 | 需配置解析与引用计数能力，与真实接入无耦合 |
| 真实 Jev 端点校准 | 外部依赖 | Jev 注册暂停（2026-09-22）；超时/退避以工程上限定案（`ADR-007`），Key 到位后补测——数值若变化只动 `constants.ts` 与 `03` 注记 |
| Marketplace 上架 | 外部依赖 | 待 `VSCE_PAT`；本版收口 = VSIX + annotated tag（同 `v0.1.0`） |
| 服务端 Proxy / 托管 Key | 范围 | `00` §5——BYOK 不变 |
| 官方 Jev SDK | 技术 | `ADR-004` 维持有效：手写 `fetch` |

---

## 2. 功能验收标准

> 验收环境：`sonecheck.endpoint` 指向契约仿真端点（`tools/jev-mock/`，本地 `wrangler dev` 或已部署 Worker，见 `ADR-007`）；故障注入经请求头 `x-jev-mock-fault`。

| 验收项 | 验证方法 | 通过标准 |
|---|---|---|
| Key 配置与保密 | 命令面板执行 `SoneCheck: Set Jev API Key` 输入后检查 | Key 写入 SecretStorage；任何界面 / 日志 / 出站内容不出现明文（`INV-03`） |
| 未配 Key 宽限 | 清除 Key 后执行检查 | 一次性引导通知（带「设置 Key」按钮）+ 状态栏短暂提示；不进错误态、不弹清单、后续检查仅状态栏提示（`ADR-006`） |
| 真实判定链路 | 对仿真端点，暂存区含敏感路径改动后执行检查 | 清单弹出，条目 `[score] 文件:行 · reason`；`score` 来自响应 `noul`，`reasonCode` 来自响应 `choice` |
| 降级五连 | 仿真端点依次注入 `disconnect` / `timeout` / `http500` / `rate429` / `badschema` | 各按 `ERR-01`~`ERR-05` 处理：放行收尾 + 一次性提示；绝不阻断、不抛未分类异常（`INV-04`） |
| 重试与超时 | 注入 `rate429` / `timeout` | `429` / `529` 恰好重试 1 次（退避 150ms）后放行；单请求 500ms 超时（`03` §2.1 定案值，实测校准） |
| 并发与性能 | ≥10 块改动、仿真端点多轮执行 | 端到端 `p95 ≤ 1s`；在飞请求数 ≤ 4（T2 断言 + 真机体感） |
| Key 清除 | 输入空串触发 `API-03` | 二次确认后清除；取消（`ERR-10`）保持原值 |
| 工作区只读 | 检查前后对比 `git status` | 工作区无任何变化（`INV-05`） |

---

## 3. 架构验收标准

| 验收项 | 通过标准 |
|---|---|
| `IJevClient` 签名零变更 | `src/infra/jevClient.ts` 的公开抽象与 `v0.1.0` 逐字一致（`ADR-002`）；`DecisionResult` 仅**纯增量**可选 `failure` 字段（见 `300-design` §4.4） |
| Key 零泄漏 | `src/` 中 `jevApiKey` 相关读写只出现在 `infra/secrets.ts`（守卫 `GUARD-06`）；出站 payload 与日志不含 Key |
| 降级不抛未分类异常 | `decide` 失败以 `DecisionResult.failure` 表达（resolve，不 reject）；`INV-01` 放行语义不变 |
| 契约状态一致 | `03` 中本版兑现项已翻 `[CURRENT]`；`ERR-08` 语义与 `ADR-006` 一致 |
| 无硬编码判定参数 | 超时 / 退避 / 并发上限 / 默认 endpoint 均来自 `constants.ts`（`INV-07`） |
| T2 契约测试建立 | `npm run test:integration` 落地且全绿（五类故障 + 重试计数 + 超时 + Key 泄漏断言） |
| 单向分层保持 | `core` / `infra` 无反向 import；`GUARD-01/02/03` 全绿 |

---

## 4. DoD (Definition of Done)

- [ ] 核心业务场景已确认（单一场景，一句话可述）
- [ ] 架构锚点已确认（§1 分层 / 模块 / 门面 / 契约 / API 均已登记）
- [ ] 受影响契约已回写至契约 SSOT（`ERR-08` 语义变更 + 翻牌集合）
- [ ] 验收标准已确认（含契约仿真端点验收环境）
- [ ] 相关设计文档已评审通过（`300-design.md`）
- [ ] 测试策略已定义（见 `300-design.md` §7；T2 首次引入）
- [ ] 关键测试场景已通过（T1 基线不降 + T2 全绿）
- [ ] `.vsix` 打包成功并可在干净 VS Code 上安装（对仿真端点）
