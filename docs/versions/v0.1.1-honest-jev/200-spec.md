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

### 5.0 通用约定

**每一步都是三段式**：`① 操作` → `② 可能输出` → `③ 判断标准`。照着做、对输出、判通过，三步都过才进下一步。

**粘贴方式分两种，别搞混**：

| 块类型 | 怎么执行 |
|---|---|
| 独立命令块（步骤 A1~A6 里的 bash） | **逐行敲**，或先删掉所有 `#` 行再整块粘贴 |
| 降级循环 | **不要复制**——直接运行 `./tools/jev-mock/preview-failures.sh`（见 §5.4） |

> `#` 开头是写给人看的注释，不是命令。整块粘贴到 zsh 会被当命令执行，报 `command not found: #`。这报错**无害**（zsh 不会因单行失败中止），但会**掩盖真实失败**，让人误以为前面的步骤没跑。

> **本节唯一需要交互的循环已落成脚本**，正是为了消灭粘贴风险——内联的 `for` 循环整块粘贴时，一旦某行报错（如 `read` 在 zsh 下的提示语法），整个循环会被中断，而中断点之后的轮次全部漏跑。

> **全部检查必须在 `sonedemo` 窗口内执行**——扩展读的是当前窗口的工作区。

### 5.1 标准态（验收开始前必须达成）

| 对象 | 标准态 | 不达标的后果 |
|---|---|---|
| **mock 进程** | 单实例；`MOCK_LATENCY_MS=100`；未设 `MOCK_FAULT`；`/stats` 的 `total=0` | 缺延迟 → #7 的 `peak>1` **物理上不可能成立**；带故障 → 所有检查都降级；计数脏 → #6 #7 取证带历史值 |
| **sonedemo git** | 暂存区恰好 13 块改动（1 敏感路径 + 12 低风险）；`.vscode/` 为 `??` 未跟踪 | hunk 数不对 → 清单条数、降级文案、`/stats` 计数全部对不上 |
| **工作区配置** | `settings.json` 含三项契约默认值（见 R3） | 用户级 `settings.json` 的遗留值会盖过它 → #2 的 Top-K 判据不成立 |
| **API Key** | **未配置**（A1 才配） | 已配则 A1 的「保存」与 A5 的「取消后保留」两条分支都验不到 |
| **VS Code 窗口** | 已 `Reload Window`（引导闩锁归零） | 引导可能已被 claim → #3 的「首次出现引导」不出现 |

### 5.2 Reset：把 sonedemo 拉回标准态

> **每次验收开始前跑一遍；中途跑乱了也可以只重跑 R2~R7。** 全部步骤幂等，可重复执行。

---

#### R1 · 停掉所有 mock 实例

**① 操作**

```bash
pkill -f jev-mock/local.mjs
sleep 0.5
lsof -ti tcp:8787
```

**② 可能输出**

R1 自身无输出。第二条命令**期望无输出**（没有进程占用 8787）。

**③ 判断标准**

- `lsof` 无输出 → ✅ 通过
- 有一个 PID → mock 还在跑，**必须继续 R1**（`pkill` 有时需要多给一次）

> 端口在 `sleep 0.5` 后即可复用（实测）。若后续 `/health` 仍报 `EADDRINUSE`，把这里的 `sleep` 加长到 1s。

---

#### R2 · 清空 sonedemo 的源码改动与暂存区

**① 操作**

```bash
cd ~/dev/sonedemo
git reset -q
git checkout -- src/
git clean -fdq src/
git status --porcelain
```

**② 可能输出**

```
?? .vscode/
```

（只应有这一行。若为空也正常，说明 `.vscode/` 尚未创建。）

**③ 判断标准**

- 只剩 `?? .vscode/`，或完全为空 → ✅ 通过
- 出现任何 `M ` / `A ` / `?? src/...` → ❌ 有残留，**检查 `git clean` 的路径是否写成了 `src/`**（不能写成仓库根，否则会删掉 `.vscode/`）

> **副作用要知道**：`-d` 会连未被 git 跟踪的**空目录**一起删。`src/utils/` 下12 个夹具文件全是未跟踪的，整个目录会被清掉——这不是 bug，R5 的 `mkdir -p` 本就负责重建。任何依赖「目录已存在」的后续步骤，都要自己 `mkdir -p`。

---

#### R3 · 写入工作区配置（三项契约默认值）

**① 操作**

```bash
mkdir -p ~/dev/sonedemo/.vscode && printf '{\n  "sonecheck.endpoint": "http://127.0.0.1:8787/v1/systemone",\n  "sonecheck.maxItems": 3,\n  "sonecheck.riskThreshold": 0.4\n}\n' > ~/dev/sonedemo/.vscode/settings.json && cat ~/dev/sonedemo/.vscode/settings.json
```

**② 可能输出**

```json
{
  "sonecheck.endpoint": "http://127.0.0.1:8787/v1/systemone",
  "sonecheck.maxItems": 3,
  "sonecheck.riskThreshold": 0.4
}
```

**③ 判断标准**

- 三项齐全 → ✅ 通过
- **路径 `/v1/systemone` 不可省**——`normalizeEndpoint` 只校验协议与主机，**不补路径**。不配则回落到 `JEV_ENDPOINT_DEFAULT`（真官方端点），改动会被真发出去，回执是「Key 或配额不可用」，完全误导
- `maxItems` / `riskThreshold` 必须显式写。调试期在**用户级** `settings.json` 留下的值（如 `maxItems: 20`、`riskThreshold: 0.2`）优先级**高于**工作区，不写就压不住，#2 的 Top-K 判据不成立

---

#### R4 · 清除 API Key（在 VS Code 内操作，无法用命令行）

**① 操作**

在 `sonedemo` 窗口：`Cmd+Shift+P` → `SoneCheck: Set Jev API Key` → **输入框留空**回车。

**② 可能输出**（二选一）

```
SoneCheck: 已清除 Jev API Key          ← 之前配过：先弹二次确认，点「清除」
SoneCheck: 未配置 API Key，无需清除      ← 本来就没配：不弹确认框
```

**③ 判断标准**

- 出现上述任一 → ✅ Key 已清空
- 若弹出二次确认，你点了**取消** → 提示「已保留原有 API Key」，Key 还在，**重做 R4**

> 这一步必须在 A1 之前完成——A1 才是「配置」，本步骤是「清空」。顺序反了会把 A5 的取消分支验不到。

---

#### R5 · 重建夹具：13 块暂存改动

**① 操作**

```bash
cd ~/dev/sonedemo
mkdir -p src/auth src/utils
printf 'export function login() {\n  if (!token) return null;\n  return true;\n}\n' > src/auth/login.ts
for i in $(seq -w 1 12); do printf 'export function util%s(a) {\n  return a + %s;\n}\n' "$i" "$i" > "src/utils/util$i.js"; done
git add src/
git --no-pager diff --staged --stat | tail -1
```

> `mkdir -p` **不可省**：R2 的 `git clean -fdq src/` 带 `-d`，会连空目录一起删。`src/utils/` 下12 个文件全未跟踪，整个目录会被清掉，R5 的重定向就会报 `no such file or directory`。这一步让 R5 不依赖 R2 的残留状态。

**② 可能输出**

```
 13 files changed, 37 insertions(+)
```

**③ 判断标准**

- **恰好 13 files changed** → ✅ 通过
- 报 `zsh: no such file or directory: src/utils/util01.js` → ❌ `src/utils/` 不存在（被 R2 的 `git clean -fd` 删除）。补 `mkdir -p src/auth src/utils` 后重跑本步
- 若是 14 → ❌ `.vscode/settings.json` 被卷进暂存区。原因只会是 `git add -A`——**必须写 `git add src/`**。一旦误加，`.vscode/settings.json` 还会按 `filePath` 升序排在清单**首位**（`.` 的 ASCII 码小于 `s`）
- 若是 12 或更少 → 夹具生成中断，检查 `src/utils/` 下是否真有 12 个文件
- 只有 1 file changed → ❌ 生成循环被前面的失败打断，重跑本步

> **写 shell 块时的一个坑**：`ls <可能不存在的路径> && mkdir ...` 这种链式写法会在 `ls` 返回非零时把后续全部跳过，而 `;` 分隔的后半段却仍会执行——结果是「看起来跑过了，实际只跑了一半」。本步骤内各命令用独立行执行，不要用 `&&` 把「预期可能失败的检查」和「要执行的命令」串在一起。

---

#### R6 · 起 mock（带 100ms 延迟、无故障、计数归零）

**① 操作**

```bash
cd /Users/woo/dev/sonecheck
MOCK_LATENCY_MS=100 PORT=8787 node tools/jev-mock/local.mjs >/tmp/mock.log 2>&1 &
sleep 1
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/stats
```

**② 可能输出**

```
{"ok":true,"model":"jev-1.13.0",...,"latencyMs":100,"defaultFault":null}
{"total":0,"byFault":{},"inFlight":{"current":1,"peak":1},"lastRequest":null,...}
```

**③ 判断标准**

| 字段 | 必须 | 不对说明什么 |
|---|---|---|
| `latencyMs` | `100` | 为 `0` 时请求瞬间完成、`inFlight` 永不重叠，#7 的 `peak>1` **在物理上不可能成立**（实测 `latencyMs=0` → `peak=1`；`latencyMs=100` → `peak=13`） |
| `defaultFault` | `null` | 非 null 表示还带着故障预设，所有检查都会降级 |
| `total` | `0` | 非 0 说明进程未真正重启，计数带历史值 |
| `inFlight.peak` | `≤ 1` | `= 1` 通常是 `/stats` 请求**自身**贡献的（`inFlight` 在 `route` 之前自增，而 `/health`、`/stats` 的早返回在 `route` 之内）。这是 mock 的已知噪音，不影响结论，修复留待 S7 之后 |

---

#### R7 · 重载窗口 + 取工作区基线快照

**① 操作**

第一步（GUI）：`Cmd+Shift+P` → `Developer: Reload Window` → 回车。

第二步（终端）：

```bash
cd ~/dev/sonedemo && git status --porcelain > /tmp/before.txt && cat /tmp/before.txt
```

**② 可能输出**

```
?? .vscode/
A  src/auth/login.ts
A  src/utils/util01.js
... (共 13 行 A)
```

**③ 判断标准**

- `/tmp/before.txt` 已生成，内容 = R2 时的状态 + 13 块暂存 → ✅ 通过。A4 要拿它比对
- `Reload Window` 执行过 → 引导闩锁已重置，A6 的「首次出现引导」才可能重现

---

### 5.3 验收步骤

> **步骤顺序不可调换**，两类原因：
>
> 1. **A3（并发取证）必须先于 A7（降级循环）**。A7 的循环每轮 `pkill` 并重启 mock，而 `inFlight` 与 `requestCounts` 是 `handler.mjs` 的**模块级变量**，进程重启即归零——并发峰值证据一旦被循环冲掉就永久丢失。
> 2. **A5（清除）必须先于 A6（宽限）**。A6 的「未配 Key」状态正是 A5 清除动作的结果，两者共用同一段连续操作，只是判据点不同。
>
> A5 / A6 不发请求（`NO_KEY` 在决策调用前短路），故不受 mock 重启影响。

---

#### A1 · #1 Key 配置与保密

**① 操作**

`Cmd+Shift+P` → `SoneCheck: Set Jev API Key` → 输入 `apikey_local_mock_placeholder` → 回车。

**② 可能输出**

```
SoneCheck: 已保存 Jev API Key
```

**③ 判断标准**

- 出现该提示 → ✅ 通过
- **Key 不明文回显**：输入框是密码样式（显示圆点），提示里只有「已保存」不含 Key 值
- 落盘位置核对：`grep -r apikey_local_mock_placeholder ~/dev/sonedemo` 应**无结果**——Key 只在 SecretStorage（macOS 上即系统钥匙串），不在项目文件、不在 `settings.json`
- 判据：`03` `INV-03` / `API-03`

---

#### A2 · #2 真实判定链路

**① 操作**

`Cmd+Shift+P` → `SoneCheck: Inspect Staged Diff`。

**② 可能输出**

弹出清单，**恰好 3 条**：

```
[0.90] src/auth/login.ts:1 · 鉴权边界
[0.90] src/utils/util01.js:1 · 鉴权边界
[0.90] src/utils/util02.js:1 · 鉴权边界
```

点任意一条 → 打开对应文件，光标跳到该行。

**③ 判断标准**

| 现象 | 判断 |
|---|---|
| **恰好 3 条**，首行是 `src/auth/login.ts:1` | ✅ 通过 |
| 13 条全出| ❌ `maxItems` 被覆盖（检查 R3 与用户级 `settings.json`） |
| 首行是 `.vscode/settings.json` | ❌ R5 误用了 `git add -A` |
| 标签不是「鉴权边界」 | ❌ `reasonCode` 未从响应 `choice` 正确归一 |
| 点条目跳错行 / 报错 | ❌ `INV-06` 定位失效 |

**为什么是这 3 条**：mock 是确定性的，13 个 hunk 全部返回 `noul = 0.90` ≥ 阈值 `0.40`，所以 13 块**全部命中**；但 `sonecheck.maxItems = 3` 只留前 3。排序为 `score` desc → `filePath` asc → `line` asc，13 条同为 `0.90` 并列，故按文件名字典序取前三个。

判据：`200-spec` §2 第 3 行 / `constants.ts` `MAX_ITEMS`

---

#### A3 · #7 并发与性能

**① 操作**

在 A2 的清单弹出后**直接关掉**，**连续跑 3 轮** `Inspect Staged Diff`。

> ⚠️ **开始前先把计数归零**——A2 已消耗 13 个请求，不归零则 `total` 判据不成立：
>
> ```bash
> cd /Users/woo/dev/sonecheck
> pkill -f jev-mock/local.mjs; sleep 0.5
> MOCK_LATENCY_MS=100 PORT=8787 node tools/jev-mock/local.mjs >/tmp/mock.log 2>&1 &
> sleep 1; curl -s http://127.0.0.1:8787/stats
> ```
>
> 期望 `total: 0`、`peak ≤ 1`。

跑完后读计数：

```bash
curl -s http://127.0.0.1:8787/stats
```

**② 可能输出**

```json
{"total":39,"byFault":{"none":39},"inFlight":{"current":1,"peak":4},...}
```

**③ 判断标准**

| 字段 | 判据 | 含义 |
|---|---|---|
| `inFlight.peak` | **= 4**（既 `≤ 4` 又 `> 1`） | 并发编排生效，且不超 `MAX_CONCURRENCY` |
| `total` | **= 13 × N**（N = 实际轮数，3 轮 → 39），且 **`total % 13 == 0`** | 每轮 13 个 hunk 各发一次，无重试、无漏发 |
| `byFault.none` | 与 `total` 相等 | 全部成功，无失败混入 |
| 体感 | 单轮 ≈ `13 ÷ 4 × 100ms ≈ 400ms` | 明显快于串行的 1.3s |

- `peak = 4` 且 `total = 13 × N` → ✅ 通过
- `peak = 1` → ❌ 两种可能：(a) R6 的 `MOCK_LATENCY_MS` 没生效（回查 `/health`）；(b) 并发编排确实失效。真要区分：带延迟时仍为 1 才是 (b)
- `peak > 4` → ❌ 并发上限被突破
- `total` 能否被 13 整除 → **不整除** = 有重试或漏发（每轮固定 13 个 hunk，多一个就是重试、少一个就是漏发）；**整除但不是 `13 × N` 且 N ≥ 2** = 归零步骤没做或轮数记错，重做本步第一步

判据：`02` §4 / `MAX_CONCURRENCY`

---

#### A4 · #8 工作区只读

**① 操作**

```bash
cd ~/dev/sonedemo
git status --porcelain > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "✅ 工作区未变"
git --no-pager diff --staged --stat | tail -1
```

**② 可能输出**

```
✅ 工作区未变
 13 files changed, 37 insertions(+)
```

**③ 判断标准**

- `diff` 无差异（打印 `✅ 工作区未变`）**且**暂存区仍是 13 → ✅ 通过
- 有差异 → ❌ 检查期间改动了工作区。若差异只在你自己新建的文件上，说明不是扩展的责任；否则是 `INV-05` 被破坏

> 中途若在 VS Code 里编辑过文件，这一步必然失败——与扩展无关，重取基线即可。

判据：`INV-05`

---

#### A5 · #4 Key 清除

**① 操作**

`Cmd+Shift+P` → `SoneCheck: Set Jev API Key` → **留空**回车 → 在二次确认框点**「取消」**。

然后**再跑一次**同样命令 → 留空回车 → 点**「清除」**。

**② 可能输出**

第一次：弹确认框「输入为空：确定清除已保存的 Jev API Key 吗？」→ 点取消 → `SoneCheck: 已保留原有 API Key`

第二次：同一确认框 → 点清除 → `SoneCheck: 已清除 Jev API Key`

**③ 判断标准**

| 分支 | 判据 |
|---|---|
| 取消后 Key 仍在 | ✅ `ERR-10` / `ERR-11`：留空必须**先弹二次确认**，拒绝则原值保留 |
| 确认后 Key 已空 | ✅ 清除生效 |
| 留空后**直接**就清掉了、没弹确认 | ❌ 未经确认即删除，是缺陷 |
| 若本来就没配 Key | 显示「未配置 API Key，无需清除」且**不弹确认框**——这是第三条合法分支 |

判据：`ERR-11` / `ERR-10`

---

#### A6 · #3 未配 Key 宽限

**① 操作**

承接 A5 的清除结果（Key 现在是空的），跑第一次 `Inspect Staged Diff`；**再跑第二次**。

**② 可能输出**

**第一次**：右上角信息通知「SoneCheck 需要 Jev API Key 才能判定改动风险」+ 按钮「设置 Key」；同时状态栏（左下）短暂显示 `SoneCheck: 未配置 Key`（约 2 秒）

**第二次**：**只有**状态栏 `SoneCheck: 未配置 Key`，引导通知**不再出现**

**③ 判断标准**

| 现象 | 判断 |
|---|---|
| 第一次有引导 + 状态栏；第二次只有状态栏 | ✅ `ADR-006` / `ERR-08` 通过 |
| 不弹清单、不进错误色（状态栏是普通色，非黄色告警） | ✅ 宽限不是故障 |
| 两次都不弹清单 | ✅ `INV-01` 未被违反 |
| 引导每次都出现 | ❌ 会话级一次性闩锁失效 |
| 引导**一次都没出现** | ❌ R7 的 `Reload Window` 没做（闩锁已被此前的调试占用） |
| 出现错误色 / 错误弹窗 | ❌ 宽限被当成故障处理 |

> 状态栏是 2 秒瞬时的，**要盯着看**。归因不在这里——这里只判「有没有引导」和「是错误色还是普通色」。

判据：`ADR-006` / `ERR-08`

#### A7 · #5 降级全谱 + #6 重试与超时

> 本步是**唯一需要逐轮人工观察**的一步，共 8 轮。先重新配好 Key（A6 已把 Key 清掉），再执行循环。

**① 操作**

第一步（GUI）：`Cmd+Shift+P` → `SoneCheck: Set Jev API Key` → 输入 `apikey_local_mock_placeholder` → 回车，确认出现「已保存」。

第二步（终端）：**直接运行脚本**（见 §5.4），不要从文档复制循环块。

**② 可能输出**

每轮终端会打印本轮的期望文案与 `/stats`，例如：

```
── 现在在 VS Code 里跑一次 Inspect Staged Diff，期望右上角通知弹窗：
   SoneCheck: 已跳过 13 块改动（网络不可达）
── 上游侧证据（必须在下一轮 pkill 之前读）：
{"total":13,"byFault":{"disconnect":13},"inFlight":{"current":1,"peak":4},...}
按回车继续 →
```

VS Code 侧每轮出现**两个通道**：

| 通道 | 位置 | 内容 |
|---|---|---|
| 状态栏 | 左下，黄色，2 秒瞬时 | `SoneCheck: 已跳过`（**不含原因**） |
| **通知弹窗** | 右上⚠️ | `SoneCheck: 已跳过 13 块改动（<原因>）` |

**③ 判断标准**

**界面侧**：八个故障每个都满足

- ✅ 弹出通知弹窗，文案与 §5.4 对照表**逐字一致**
- ✅ **不弹清单**、**不阻断**（照常能继续提交）
- ✅ 状态栏显示「已跳过」且为黄色告警底色
- ❌ **只盯状态栏会误判**——归因标签只出现在弹窗里，状态栏一律只有「已跳过」四字

**上游侧**（每轮的 `/stats`）：与 §5.4 对照表最后一列一致

| 故障 | `byFault` 期望 | 错误码 | 归因标签 |
|---|---|---|---|
| `disconnect` | `disconnect = 13` | `ERR-01` | 网络不可达 |
| `timeout` | `timeout = 13`（超时不重试） | `ERR-02` | 服务超时 |
| `http500` | `http500 = 13` | `ERR-03` | 服务异常 |
| `unauthorized` | `unauthorized = 13` | `ERR-04` | Key 或配额不可用 |
| `forbidden` | `forbidden = 13` | `ERR-04` | Key 或配额不可用 |
| `rate429` | **`rate429 = 26`** ← #6 硬证据 | `ERR-04` | Key 或配额不可用 |
| `rate529` | **`rate529 = 26`** ← #6 硬证据 | `ERR-04` | Key 或配额不可用 |
| `badschema` | `badschema = 13` | `ERR-05` | 响应不合规 |

- ✅ 全部 8 轮界面与计数**都对得上** → #5 与 #6 同时通过
- ❌ `http500` 显示「网络不可达」而非「服务异常」→ 归因串了，`ERR-01` 与 `ERR-03` 混淆
- ❌ `rate429` 计数不是 26 → 重试策略不对（应为恰好重试 1 次，退避 150ms）
- ❌ 任一轮出现未捕获异常、清单弹出、或阻断操作 → `INV-04` 被破坏

判据：`200-spec` §2 第 4 行 / `INV-04` / `03` §2.1 重试策略

---

#### A8 · 恢复环境

**① 操作**

```bash
pkill -f jev-mock/local.mjs; sleep 0.5
cd /Users/woo/dev/sonecheck
MOCK_LATENCY_MS=100 PORT=8787 node tools/jev-mock/local.mjs >/tmp/mock.log 2>&1 &
sleep 1; curl -s http://127.0.0.1:8787/health
```

**② 可能输出**

```
{"ok":true,"model":"jev-1.13.0",...,"latencyMs":100,"defaultFault":null}
```

**③ 判断标准**

- `defaultFault` 回到 `null` → ✅ 环境已复原，验收结束
- 仍为某个故障名 → R1 / R6 走漏了

---

### 5.4 降级全谱循环脚本

扩展的普通请求**不带故障头**，故降级必须由**端点侧预设**（`MOCK_FAULT`）才能复现。

**执行方式：直接运行仓库里的脚本，不要从文档复制。**

```bash
cd /Users/woo/dev/sonecheck
./tools/jev-mock/preview-failures.sh
```

脚本会自动 `cd` 到仓库根，逐轮重启带故障的 mock、打印该轮的期望文案与错误码、等你回车后读 `/stats`。

> **为什么落成文件而不是文档内联**：内联块需要整块粘贴，而整块粘贴在 zsh 下会踩两类坑——① `#` 注释行被当命令执行；② `read` 的提示语法在 bash 与 zsh 之间不兼容。`read -r "按回车继续 → "` 在 bash 下被当成变量名而静默失败，在 **zsh 下直接报 `zsh: not an identifier: 按回车继续 →` 并中断整个循环**。脚本里改用 `printf` 输出提示 + `read -r _`，两种shell 行为一致（已过`bash -n` / `zsh -n` 语法校验）。
>
> 脚本把 `/stats` 取证内联到每轮——`pkill` 会重启 mock，而 `requestCounts` / `inFlight` 是 `handler.mjs` 的模块级变量，重启即归零。**攒到循环结束再读 `/stats` 是拿不到重试次数的**（只能看到最后一轮）。

> **故障轮次不注入 `MOCK_LATENCY_MS`**——降级观察的是文案与归因，不需要延迟。缺延迟时 `inFlight.peak` 会是 1，属预期，不影响本步判据。

**故障 → 上游状态对照**

| 注入故障 | 上游状态 | 期望归因标签 | 错误码 | `/stats` 期望 |
|---|---|---|---|---|
| `disconnect` | 连接被切断 | 网络不可达 | `ERR-01` | `byFault.disconnect = 13` |
| `timeout` | 挂起 3s | 服务超时 | `ERR-02` | `byFault.timeout = 13`（超时不重试） |
| `http500` | `500` | 服务异常 | `ERR-03` | `byFault.http500 = 13` |
| `unauthorized` | `401` | Key 或配额不可用 | `ERR-04` | `byFault.unauthorized = 13` |
| `forbidden` | `403` | Key 或配额不可用 | `ERR-04` | `byFault.forbidden = 13` |
| `rate429` | `429`（重试 1 次） | Key 或配额不可用 | `ERR-04` | **`byFault.rate429 = 26`** ← #6 硬证据 |
| `rate529` | `529`（重试 1 次） | Key 或配额不可用 | `ERR-04` | **`byFault.rate529 = 26`** |
| `badschema` | `200` 但不合规 | 响应不合规 | `ERR-05` | `byFault.badschema = 13` |

> 文案来自 `describeDegraded`：前缀 `SoneCheck: ` + `已跳过 N 块改动（原因、原因）`。13 块同类失败时括号内只有**一个**原因（`degraded` 已按 code 归并计数），不是 13 次重复。
>
> `disconnect` 与 `http500` 极易看混——前者「网络不可达」，后者「**服务异常**」。两者错误码不同（`ERR-01` / `ERR-03`）。

### 5.5 证据字段说明（`/stats`）

```bash
curl -s http://127.0.0.1:8787/stats
```

| 字段 | 含义 | 判据 |
|---|---|---|
| `inFlight.peak` | 并发峰值 | A3 中 = **4**；A7 故障轮次为 `1`（无延迟，属预期） |
| `byFault.rate429` / `rate529` | 限流 / 过载计数 | 各 = **26**（13 块 × 2 次） |
| `byFault.<其他>` | 各自故障计数 | = 13 |
| `total` | 总请求数 | 与各 `byFault` 之和一致 |
| `lastRequest` | 最近一次**请求体** | 断言其中**不含 Key**（mock 只记 body 不记 header，`INV-03`） |

> **取证时机**：这是 A7 每轮的**内联动作**，不是收尾步骤。所有计数都随 mock 进程重启归零，跨进程累积读取必然失真。收口时 AI 读取的是**累计报告**，不是现场重读。

### 5.6 验收记录（收口时填写）

> `序` 对应 §5.3 的步骤编号；`#` 对应 §2 判据表与 Issue #3 的清单。

| 序 | # | 验收项 | 结果 | 证据 / 备注 |
|---|---|---|---|---|
| R1~R7 | — | Reset 到标准态 | ☐ | |
| A1 | #1 | Key 配置与保密 | ☐ | |
| A2 | #2 | 真实判定链路 | ☐ | |
| A3 | #7 | 并发与性能 | ☐ | |
| A4 | #8 | 工作区只读 | ☐ | |
| A5 | #4 | Key 清除 | ☐ | |
| A6 | #3 | 未配 Key 宽限 | ☐ | |
| A7 | #5 | 降级全谱（8 故障） | ☐ | |
| A7 | #6 | 重试与超时 | ☐ | |
| A8 | — | 恢复环境 | ☐ | |

> **范围外**：Marketplace 上架（待 `VSCE_PAT`）与真实端点校准（待 Jev Key，`ADR-007` 挂账）——两者均 `[DEFERRED]`，不阻塞本版收口。
