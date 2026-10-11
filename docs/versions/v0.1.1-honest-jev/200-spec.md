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

> ⚠️ **执行方式：逐行敲，或先删净所有 `#` 行再整块粘贴。**
> `#` 开头是**写给人看的注释**，不是命令。整块粘贴进 zsh 时它们会被逐行执行，报 `command not found: #`。该报错**无害**（zsh 不会因单行失败中止），但会**掩盖真实失败**，也容易让人误以为前面的步骤没跑。
>
> 与 §5.3 的循环块不同——那段是 `for` 循环，**必须整块执行**，否则只跑一半。

```bash
# ① 安装产物（干净 VS Code）
code --install-extension extension/sonecheck-0.1.1.vsix
code --list-extensions --show-versions | grep sonecheck
#   ↑ 期望 rolligen.sonecheck@0.1.1
#   ⚠️ 「期望 …」不要写在命令行尾——会被 shell 连同注释词一起当参数传给 grep

# ② 起契约仿真端点（无预设故障 + 100ms 延迟）——幂等，已在跑就不重复起
#   ⚠️ MOCK_LATENCY_MS=100 不可省：延迟为 0 时请求瞬间完成，inFlight 永不重叠，
#      #7 的 peak>1 判据在物理上不可能成立（实测 latency=0 → peak=1）。T2 同理。
curl -sf http://127.0.0.1:8787/health >/dev/null || MOCK_LATENCY_MS=100 PORT=8787 node tools/jev-mock/local.mjs &
sleep 1
curl -s http://127.0.0.1:8787/health
#   ↑ 期望 ok:true、faults 八项、defaultFault:null、latencyMs:100
#   ⚠️ 若报 EADDRINUSE：说明 mock 已在运行（多半是调试期留下的，且多半没带延迟）。
#     **不要重复启动，也不要 pkill**——旧进程若计数已污染或缺延迟，需重启才能重来；
#     处置见 §5.1.2。`curl` 能通只说明旧进程在服务，须核对上行的 latencyMs。

# ③ 夹具：13 块暂存改动（1 敏感路径 + 12 低风险）
cd ~/dev/sonedemo && git reset -q
printf 'export function login() {\n  if (!token) return null;\n  return true;\n}\n' > src/auth/login.ts
for i in $(seq -w 1 12); do printf 'export function util%s(a) {\n  return a + %s;\n}\n' "$i" "$i" > "src/utils/util$i.js"; done
git add src/ && git --no-pager diff --staged --stat | tail -1
#   ↑ 期望 13 files changed
#   ⚠️ 用 git add src/ 而非 git add -A：后者会把④ 创建的 .vscode/ 也扫进暂存区，
#      hunk 数变 14，且 .vscode/settings.json 排在清单首位（. < s）。重跑③ 就会复发。

# ④ 工作区配置——必须执行，否则会打到真实 Jev 官方端点
mkdir -p ~/dev/sonedemo/.vscode && printf '{\n  "sonecheck.endpoint": "http://127.0.0.1:8787/v1/systemone",\n  "sonecheck.maxItems": 3,\n  "sonecheck.riskThreshold": 0.4\n}\n' > ~/dev/sonedemo/.vscode/settings.json && cat ~/dev/sonedemo/.vscode/settings.json
#   ↑ 期望 cat 出三行：endpoint / maxItems 3 / riskThreshold 0.4
#   ⚠️ 路径 /v1/systemone 不可省——normalizeEndpoint 只做协议与主机校验，不补路径。
#      不配则用 JEV_ENDPOINT_DEFAULT（真官方端点），改动会被真发出去，回执是
#      「Key 或配额不可用」——完全误导。
#   ⚠️ 三项都要写：maxItems / riskThreshold 是为了压住用户级 settings.json 的遗留值，
#      否则 #2 的 Top-K 判据不成立（见 §5.1.2）。
```

> 全部命令须在 VS Code 的 **`sonedemo` 窗口**内执行检查——扩展读的是当前窗口的工作区。

### 5.1.1 开跑前的三个前置动作（顺序敏感，漏做会产生假阴性）

| 动作 | 为什么必须先做 |
|---|---|
| `Cmd+Shift+P` → **`Developer: Reload Window`** | 验收 3 期望「首次出现引导」。引导闩锁 `createSessionGuide()` 是 `registerCommands` 内的**内存闭包，每窗口一份、只随窗口重载重置**。调试期若已跑过未配 Key 的检查，闩锁已被 claim，引导不再重现——会被误判成功能缺陷 |
| 取工作区快照 `cd ~/dev/sonedemo && git status --porcelain > /tmp/before.txt` | 验收 8 要比对前后两次快照。中途若在编辑器里改了文件，比对必然失败，而失败原因与扩展无关 |
| 核对 mock 计数是否干净（§5.1.2） | `/stats` 的 `total` / `inFlight.peak` 只随进程重启归零。调试期已产生请求时，验收 #6 / #7 的取证会带上无法解释的历史值 |

### 5.1.2 计数归零（`/stats` 不干净时才需要）

```bash
curl -s http://127.0.0.1:8787/stats
```

期望 `total: 0`、`byFault: {}`、`inFlight.peak ≤ 1`。

> `peak = 1` 通常是 `/stats` 请求**自身**贡献的——`inFlight` 在 `route` 之前自增，而 `/health` 与 `/stats` 的早返回分支在 `route` 之内，因此这两个控制面请求也被计入并发峰值（`total` 不受影响，它只在 `/v1/systemone` 分支自增）。这是 mock 的已知噪音，**不影响 #7 的结论**（13 块真实请求必然把峰值推到 4）。修复留待 S7 之后，不在本版范围内。

**同时核对两件容易被忽略的事**：

| 检查 | 怎么看 | 不对时 |
|---|---|---|
| **用户级配置是否覆盖了工作区默认值** | `grep sonecheck ~/Library/Application\ Support/Code/User/settings.json` | 调试期遗留值（如 `maxItems: 20`、`riskThreshold: 0.2`）会**盖过**工作区 `settings.json`，使 #2 的 Top-K 与阈值判据不成立。工作区级优先级更高，故④ 已显式写入契约默认值 |
| **mock 是否带延迟** | `/health` 上行的 `latencyMs` 须为 `100` | 为 `0` 时 #7 的 `peak > 1` 在物理上不可能成立（见 ② 的注记） |

不干净时才重启（重启会让 §5.3 尚未完成的取证一并失效，故只在开始前做）：

```bash
pkill -f jev-mock/local.mjs; sleep 0.5
MOCK_LATENCY_MS=100 PORT=8787 node tools/jev-mock/local.mjs &
sleep 1; curl -s http://127.0.0.1:8787/stats
```

> 端口在 `sleep 0.5` 后即可复用（实测）。若仍 `EADDRINUSE`，把 `sleep` 加长到 1s。

### 5.2 逐项操作与期望

> **本表已按执行顺序排列，照着从上往下做即可**，无需再自己排序。`序` 是操作次序，`#` 是验收项编号（对应 §2 判据表与 §5.5 记录表）——两者不同是因为存在两类顺序依赖：
>
> 1. **并发取证（#7）必须先于降级循环（#5、#6）**。§5.3 的循环每轮 `pkill` 并重启 mock，而 `inFlight` 与 `requestCounts` 是 `handler.mjs` 的**模块级变量**，进程重启即归零——并发峰值证据一旦被循环冲掉就永久丢失。
> 2. **#4 必须先于 #3**。#3 的「未配 Key」状态正是 #4 清除动作的结果，两者共用同一段连续操作，只是判据点不同。
>
> #3 / #4 不发请求（`NO_KEY` 在决策调用前短路），故不受 mock 重启影响。

| 序 | # | 验收项 | 操作 | 期望结果 | 判据 |
|---|---|---|---|---|---|
| 1 | #1 | Key 配置与保密 | `SoneCheck: Set Jev API Key` → 输入 `apikey_local_mock_placeholder` | 提示「已保存 Jev API Key」；工作区与 settings **无明文** | `03` `INV-03` / `API-03` |
| 2 | #2 | 真实判定链路 | 跑 `SoneCheck: Inspect Staged Diff` | 清单弹出，且**恰好 3 条**——13 块全部命中阈值（mock 恒返回 `0.90` ≥ `0.4`），但只留前 3（`sonecheck.maxItems = 3`）。排序为 `score` desc → `filePath` asc → `line` asc，13 条同为 `0.90` 并列，故依次为 `[0.90] src/auth/login.ts:1`、`[0.90] src/utils/util01.js:1`、`[0.90] src/utils/util02.js:1`，均带 ` · 鉴权边界`；点击跳到对应行。⚠️ 前提是④ 已写入工作区 `maxItems: 3`——用户级 settings.json 的遗留值会盖过它（§5.1.2）。清单里**若出现 `.vscode/settings.json`**，说明③ 误用了 `git add -A` | `200-spec` §2 第 3 行 / `constants.ts` `MAX_ITEMS` |
| 3 | #7 | 并发与性能 | 13 块**连跑 3轮**（每轮关掉清单），然后读 `/stats` | `inFlight.peak` = **4**（既 `≤ 4` 又 `> 1`）；`total` = **39**（3 × 13）。⚠️ 必须先确认 mock 带 `MOCK_LATENCY_MS=100`——延迟为 0 时请求瞬间完成、inFlight 永不重叠，`peak > 1` 在物理上不可能成立（实测 `latencyMs=0` → `peak=1`，`latencyMs=100` → `peak=13`）。单轮耗时 ≈ `13 ÷ 4 × 100ms ≈ 400ms` | `02` §4 / `MAX_CONCURRENCY` |
| 4 | #8 | 工作区只读 | 跑 `git status --porcelain > /tmp/after.txt`，与 §5.1.1 取的 `/tmp/before.txt` 比对 | 两次输出**完全一致**（检查不得改动工作区）；暂存区仍是 `13 files changed`，`.vscode/` 仍为 `??` 未跟踪 | `INV-05` |
| 5 | #4 | Key 清除 | `setApiKey` → 留空回车 → 确认框点**取消**；再跑一次 → 留空回车 → 点**清除** | 取消分支：提示「已保留原有 API Key」，Key 仍在。清除分支：提示「已清除 Jev API Key」。两次都**先弹二次确认**才动存储（`ERR-11`）；若本来就没配 Key，则提示「未配置 API Key，无需清除」且**不弹确认框** | `ERR-11` / `ERR-10` |
| 6 | #3 | 未配 Key 宽限 | 承接上一步的清除结果，跑检查 → **再跑一次** | 清除后首次：一次性引导（带「设置 Key」按钮）+ 状态栏 `未配置 Key`（2 秒瞬时）；第二次：**仅**状态栏，引导不再出现。两次都**不弹清单、不进错误态、不发任何请求**。⚠️ 依赖 §5.1.1 的 `Reload Window`，否则引导不出现 | `ADR-006` / `ERR-08` |
| 7 | #5 | 降级全谱 | 按 §5.3 循环逐个故障观察；**须先重新配好 Key**（上一步已清除） | **两个通道都要看**：① 状态栏（左下，黄色，2 秒瞬时）`SoneCheck: 已跳过`；② **通知弹窗**（右上 ⚠️）`SoneCheck: 已跳过 13 块改动（<原因>）`。**归因标签只出现在弹窗里，状态栏不含原因**——只盯状态栏会误判「降级文案没生效」。八个故障各自映射到正确标签；每次都**不弹清单、不阻断**、退出码正常 | `200-spec` §2 第 4 行 / `INV-04` / `ui/status.ts` |
| 8 | #6 | 重试与超时 | §5.3 循环中的 `rate429` / `rate529` 两轮 | 用户侧无差别；**在该轮 `pkill` 之前**读 `/stats`：`byFault.rate429` = **块数 × 2 = 26**（1 次 + 1 次重试），`rate529` 同理。其余六种故障各 = 13 | `03` §2.1 重试策略 |
| 9 | — | 恢复环境 | `pkill -f jev-mock/local.mjs` 后按 §5.1 ② 重起 | `/health` 恢复 `ok:true` | — |

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

> 按**执行顺序**排列，与 §5.2 一致；`#` 列对应 §2 判据表与 Issue #3 的清单。

| 序 | # | 验收项 | 结果 | 证据 / 备注 |
|---|---|---|---|---|
| 1 | #1 | Key 配置与保密 | ☐ | |
| 2 | #2 | 真实判定链路 | ☐ | |
| 3 | #7 | 并发与性能 | ☐ | |
| 4 | #8 | 工作区只读 | ☐ | |
| 5 | #4 | Key 清除 | ☐ | |
| 6 | #3 | 未配 Key 宽限 | ☐ | |
| 7 | #5 | 降级全谱（8 故障） | ☐ | |
| 8 | #6 | 重试与超时 | ☐ | |

> **范围外**：Marketplace 上架（待 `VSCE_PAT`）与真实端点校准（待 Jev Key，`ADR-007` 挂账）——两者均 `[DEFERRED]`，不阻塞本版收口。
