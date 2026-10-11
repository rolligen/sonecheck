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
| 模块 | **新建** `src/infra/secrets.ts`（SecretStorage 唯一出口）；**重写** `src/infra/jevClient.ts`（真实 HTTP 客户端，`v0.1.0` 的 `scoreHunk` mock 移入 `test/` 作 T1 fixture）；`core/riskEngine` 增并发编排（semaphore，上限 4）并产出**检查报告**（`items` / `degraded` / `skipped` 三字段，使「空清单」永远有可解释原因）；`ui/commands` 增 `setApiKey` 与未配 Key 引导；`infra/configSource` / `core/config` 增 `endpoint` 归一；`src/constants.ts` 增量（超时 / 退避 / 并发上限 / 模型 ID / 默认 endpoint） | Key 读取与写入只出现在 `infra/secrets.ts`（`INV-03`）；网络与重试逻辑只出现在 `infra/jevClient`；并发上限、超时、模型 ID 等字面量只取自 `constants.ts`（`INV-07`） |
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
| 降级全谱 | 仿真端点注入 `disconnect` / `timeout` / `http500` / `badschema` / `unauthorized`(401) / `forbidden`(403) / `rate429` / `rate529` | 各按 `ERR-01`~`ERR-05` 处理（`ERR-04` 覆盖 401 / 403 / 429 / 529 四个状态码）：放行收尾 + 一次性提示；绝不阻断、不抛未分类异常（`INV-04`） |
| 重试与超时 | 注入 `rate429` / `timeout` | `429` / `529` 恰好重试 1 次（退避 150ms）后放行；单请求 500ms 超时（`03` §2.1 定案值，实测校准） |
| 并发与性能 | ≥10 块改动、仿真端点多轮执行 | 端到端 `p95 ≤ 1s`；在飞请求数 ≤ 4（T2 断言 + 真机体感）。**边界（S3 真实端点实测）**：单请求 p50 ≈ 170–240ms，12 块（3 波）≈ 0.5–0.8s ✓；24 块（6 波）≈ 1.2s ✗ —— **预算成立的前提是单次检查 ≲ 16 块**，超出后仍按 `INV-04` 放行不阻断 |
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
| T2 契约测试建立 | `npm run test:integration` 落地且全绿（`ERR-01`~`05` 故障全谱，含 401 / 403 / 429 / 529 + 重试计数 + 超时 + Key 泄漏断言） |
| 仿真端点与上游一致 | `tools/jev-mock` 对上游实测口径（`400` / `401` / `403` / `422` / `429` / `529`）逐项对齐且**不宽松于上游**——否则 T2 出现假绿 |
| 单向分层保持 | `core` / `infra` 无反向 import；`GUARD-01/02/03` 全绿 |

---

## 4. DoD (Definition of Done)

- [ ] 核心业务场景已确认（单一场景，一句话可述）
- [ ] 架构锚点已确认（§1 分层 / 模块 / 门面 / 契约 / API 均已登记）
- [ ] 受影响契约已回写至契约 SSOT（`ERR-08` 语义变更 + 翻牌集合）
- [ ] 验收标准已确认（含契约仿真端点验收环境）
- [ ] 相关设计文档已评审通过（`300-design.md`）
- [ ] 测试策略已定义（见 `300-design.md` §7；T2 首次引入）
- [ ] 关键测试场景已通过（T1 ≥107 例 / 12 文件、T2 ≥12 例，两层只增不降）
- [ ] `.vsix` 打包成功并可在干净 VS Code 上安装（对仿真端点）

---

## 5. 真机验收清单（对契约仿真端点）

> §2 给判据，本节给**可复现的操作步骤**。收口时逐项勾选并填结果，结果摘要写入 `500-schedule.md` §3 的 S7 执行记录。
> 全程**不需要真实 Jev Key**——端点是本地仿真，鉴权不被校验；这也正是「代码全真、只差上游」的验证方式（`ADR-007`）。

### 5.1 验收环境准备

```bash
# ① 安装产物（干净 VS Code）
code --install-extension extension/sonecheck-0.1.1.vsix
code --list-extensions --show-versions | grep sonecheck
#   ↑ 期望 rolligen.sonecheck@0.1.1
#   ⚠️ 不要把「期望 …」写在本行行尾——会被 shell 连同注释词一起当参数传给 grep

# ② 起契约仿真端点（无预设故障）
PORT=8787 node tools/jev-mock/local.mjs &
curl -s http://127.0.0.1:8787/health
#   ↑ 期望 ok:true、faults 八项、defaultFault:null

# ③ 夹具：13 块暂存改动（1 敏感路径 + 12 低风险）
cd ~/dev/sonedemo && git reset -q
printf 'export function login() {\n  if (!token) return null;\n  return true;\n}\n' > src/auth/login.ts
for i in $(seq -w 1 12); do printf 'export function util%s(a) {\n  return a + %s;\n}\n' "$i" "$i" > "src/utils/util$i.js"; done
git add -A && git --no-pager diff --staged --stat | tail -1
#   ↑ 期望 13 files changed

# ④ 工作区配置（否则会打到真实上游）
#    settings.json： "sonecheck.endpoint": "http://127.0.0.1:8787/v1/systemone"
```

> 全部命令须在 VS Code 的 **`sonedemo` 窗口**内执行检查——扩展读的是当前窗口的工作区。

### 5.1.1 开跑前的两个前置动作（顺序敏感，漏做会产生假阴性）

| 动作 | 为什么必须先做 |
|---|---|
| `Cmd+Shift+P` → **`Developer: Reload Window`** | 验收 3 期望「首次出现引导」。引导闩锁 `createSessionGuide()` 是 `registerCommands` 内的**内存闭包，每窗口一份、只随窗口重载重置**。调试期若已跑过未配 Key 的检查，闩锁已被 claim，引导不再重现——会被误判成功能缺陷 |
| 取工作区快照 `cd ~/dev/sonedemo && git status --porcelain > /tmp/before.txt` | 验收 8 要比对前后两次快照。中途若在编辑器里改了文件，比对必然失败，而失败原因与扩展无关 |

### 5.2 逐项操作与期望

> **执行顺序不可调换**：#5 / #6 / #7 的证据全部来自**同一个 mock 进程**的 `/stats`。§5.3 的降级循环每轮会 `pkill` 并重启 mock，而 `inFlight` 与 `requestCounts` 是 `handler.mjs` 的**模块级变量**，进程重启即归零。因此**并发取证（#7）必须先于降级循环（#5、#6）**，否则并发峰值证据永久丢失。
>
> 建议顺序：#1 → #2 → #7 → #8 → #3 → #4 → #5/#6 → 恢复 mock。#7 的请求须在故障注入**之前**跑完，`inFlight.peak` 才是干净可归因的。#3 / #4 不发请求（`NO_KEY` 零请求短路），故不受 mock 重启影响。

| # | 验收项 | 操作 | 期望结果 | 判据 |
|---|---|---|---|---|
| 1 | Key 配置与保密 | `SoneCheck: Set Jev API Key` → 输入 `apikey_local_mock_placeholder` | 提示「已保存 Jev API Key」；工作区与 settings **无明文** | `03` `INV-03` / `API-03` |
| 2 | 真实判定链路 | 跑 `SoneCheck: Inspect Staged Diff` | 清单弹出，且**恰好 3 条**——13 块全部命中阈值，但只留前 3（`MAX_ITEMS = 3`）。排序为 `score` desc → `filePath` asc → `line` asc，13 条同为 `0.90` 并列，故依次为 `[0.90] src/auth/login.ts:1`、`[0.90] src/utils/util01.js:1`、`[0.90] src/utils/util02.js:1`，均带 ` · 鉴权边界`；点击跳到对应行。**要看全部 13 条须配 `"sonecheck.maxItems": 13`** | `200-spec` §2 第 3 行 / `constants.ts` `MAX_ITEMS` |
| 3 | 未配 Key 宽限 | `setApiKey` → **输入空串** → 确认清除 → 跑检查 → **再跑一次** | 清除后首次：一次性引导（带「设置 Key」按钮）+ 状态栏 `未配置 Key`；第二次：**仅**状态栏；两次都**不弹清单、不进错误态**。⚠️ 依赖 §5.1.1 的 `Reload Window`，否则引导不出现 | `ADR-006` / `ERR-08` |
| 4 | Key 清除 | 同上第三步的确认弹窗 | 二次确认后清除；取消则保留原值并提示「已保留原有 API Key」 | `ERR-11` / `ERR-10` |
| 5 | 降级全谱 | 见 §5.3 引导循环，逐个故障观察 | **两个通道都要看**：① 状态栏（左下，黄色，2 秒瞬时）`SoneCheck: 已跳过`；② **通知弹窗**（右上 ⚠️）`SoneCheck: 已跳过 13 块改动（<原因>）`。**归因标签只出现在弹窗里，状态栏不含原因**——只盯状态栏会误判「降级文案没生效」。八个故障各自映射到正确标签；每次都**不弹清单、不阻断** | `200-spec` §2 第 4 行 / `INV-04` / `ui/status.ts` |
| 6 | 重试与超时 | 循环中的 `rate429` / `timeout` | 用户侧无差别；**在该轮 `pkill` 之前**读 `GET /stats`：`byFault.rate429` = **块数 × 2 = 26**（1 次 + 1 次重试），`rate529` 同理 | `03` §2.1 重试策略 |
| 7 | 并发与性能 | 13 块多跑几轮 | 体感无卡顿；`/stats` 的 `inFlight.peak` **≤ 4** 且 **> 1** | `02` §4 / `MAX_CONCURRENCY` |
| 8 | 工作区只读 | 检查前后各跑一次 `git status --porcelain` 并 diff | 两次输出**完全一致** | `INV-05` |

### 5.3 降级全谱引导循环

扩展的普通请求不带故障头，故降级需由**端点侧预设**（`MOCK_FAULT`）。逐个观察、逐个确认。

循环脚本已内置**每轮取证**：`pkill` 会重启 mock 进程，而 `requestCounts` / `inFlight` 是 `handler.mjs` 的模块级变量，重启即归零——所以 `/stats` 必须在**本轮 `pkill` 之前**读，攒到最后一起读是拿不到重试次数的。

```bash
cd /Users/woo/dev/sonecheck
for f in disconnect timeout http500 unauthorized forbidden rate429 rate529 badschema; do
  pkill -f jev-mock/local.mjs; sleep 0.5
  MOCK_FAULT=$f PORT=8787 node tools/jev-mock/local.mjs >/dev/null 2>&1 &
  sleep 1
  echo "── 现在在 VS Code 里跑一次 Inspect Staged Diff，期望右上角通知弹窗："
  case $f in
    disconnect)           echo "   SoneCheck: 已跳过 13 块改动（网络不可达）";;
    http500)              echo "   SoneCheck: 已跳过 13 块改动（服务异常）";;
    timeout)              echo "   SoneCheck: 已跳过 13 块改动（服务超时）";;
    unauthorized|forbidden|rate429|rate529) echo "   SoneCheck: 已跳过 13 块改动（Key 或配额不可用）";;
    badschema)            echo "   SoneCheck: 已跳过 13 块改动（响应不合规）";;
  esac
  echo "── 上游侧证据（必须在下一轮 pkill 之前读）："
  curl -s http://127.0.0.1:8787/stats; echo
  read -r "按回车继续 → "
done
```

> `disconnect` 与 `http500` 在旧版脚本里合写成一行「网络不可达 / 服务异常」，但两者归因**不同**（`ERR-01` / `ERR-03`，标签也不同），已按上表拆开——照旧版执行会把两个不同标签看成一个。
>
> 文案来自 `describeDegraded`：前缀 `SoneCheck: ` + `已跳过 N 块改动（原因、原因）`。13 块同类失败时括号内只有**一个**原因（`degraded` 已按 code 归并计数），不是 13 次重复。

| 注入故障 | 上游状态 | 期望归因标签 | 对应错误码 | `/stats` 取证 |
|---|---|---|---|---|
| `disconnect` | 连接被切断 | 网络不可达 | `ERR-01` | `byFault.disconnect = 13`，`inFlight.peak = 4` |
| `timeout` | 挂起 3s | 服务超时 | `ERR-02` | `byFault.timeout = 13`（超时不重试） |
| `http500` | `500` | 服务异常 | `ERR-03` | `byFault.http500 = 13` |
| `unauthorized` | `401` | Key 或配额不可用 | `ERR-04` | `byFault.unauthorized = 13` |
| `forbidden` | `403` | Key 或配额不可用 | `ERR-04` | `byFault.forbidden = 13` |
| `rate429` | `429`（重试 1 次） | Key 或配额不可用 | `ERR-04` | `byFault.rate429 = 26` ← **验收 6 的硬证据** |
| `rate529` | `529`（重试 1 次） | Key 或配额不可用 | `ERR-04` | `byFault.rate529 = 26` |
| `badschema` | `200` 但不合规 | 响应不合规 | `ERR-05` | `byFault.badschema = 13` |

> 故障态下 `inFlight.peak` 仍应为 4 —— 请求已发出才失败，并发上限与故障无关。若在故障轮次测出 `peak = 1`，说明并发编排未生效，属缺陷而非预期。

### 5.4 上游侧客观证据（字段说明与取证时机）

```bash
curl -s http://127.0.0.1:8787/stats
```

| 字段 | 含义 | 判据 |
|---|---|---|
| `inFlight.peak` | 并发峰值 | **≤ 4 且 > 1**（`MAX_CONCURRENCY = 4`） |
| `byFault.rate429` / `byFault.rate529` | 限流/过载计数 | 各 = **26**（13 块 × 2 次） |
| `byFault.<其他>` | 各自故障计数 | = 13 |
| `total` | 总请求数 | 与各 `byFault` 之和一致 |
| `lastRequest` | 最近一次**请求体** | 断言其中**不含 Key**（mock 只记 body 不记 header，`INV-03`） |

> **取证时机**：这是 §5.3 每轮的内联动作，不是收尾步骤。所有计数都随 mock 进程重启归零，跨进程累积读取必然失真。收口时 AI 读取的是**累计报告**，不是现场重读。

### 5.5 验收记录（收口时填写）

| # | 验收项 | 结果 | 备注 |
|---|---|---|---|
| 1 | Key 配置与保密 | ☐ | |
| 2 | 真实判定链路 | ☐ | |
| 3 | 未配 Key 宽限 | ☐ | |
| 4 | Key 清除 | ☐ | |
| 5 | 降级全谱（8 故障） | ☐ | |
| 6 | 重试与超时 | ☐ | |
| 7 | 并发与性能 | ☐ | |
| 8 | 工作区只读 | ☐ | |

> **范围外**：Marketplace 上架（待 `VSCE_PAT`）与真实端点校准（待 Jev Key，`ADR-007` 挂账）——两者均 `[DEFERRED]`，不阻塞本版收口。
