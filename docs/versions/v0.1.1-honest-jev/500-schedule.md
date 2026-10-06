# v0.1.1 版本排程

> 模板用途：快速起草版本工作包排程、执行记录与一人团队防沉迷红线。
> 结构唯一权威：`skills/dm-schedule.md` 的「模板结构」节（排程单一权威）。
> ⚠️ 本文件是**进度状态**（⬜ / 🔄 / ✅）与**执行记录**的唯一承载处；`400-build.md` 只记「执行态」，二者不重复。

> **关联 Roadmap 版本：** `v0.1.1-honest-jev`
> **上线卡点：** 待定（Marketplace 上架待 `VSCE_PAT`，同 `v0.1.0` 收口口径）
> **首期目标：** 判定服务客户端真实化（mock 换真身、失败不阻断、并发 ≤4），对契约仿真端点完成验收（`ADR-007`）

## 1. 一人团队防沉迷红线

1. **契约先行**：本版的契约回写（超时/退避定案、`ERR-08` 语义、`endpoint`）已在开工前经 ADR-006/007 定案；开发中发现契约缺口必须停下走 `dm-adr`，禁止边写边改契约。
2. **2 小时停损原则**：wrangler / workerd 环境问题若超过 2 小时无果，立刻降级为 `local.mjs` 纯 Node 兜底，不恋战。
3. **闭环高于完美**：优先保证「真身可换、失败放行」主路径通畅；真实端点校准与 O2 埋点均已显式顺延。
4. **每周日强制对账**：对照本表打勾，超时的工作包通过砍掉后续非核心项补偿时间。Step 内部步骤可重排优先级，但 **Step 本身不可分割**。

## 2. 工作包列表（按执行顺序排列）

| # | ID | 类别 | 环节 | 工作内容 | 难度 | 预估工时 | 验收标准 | 状态 |
|---|-----|------|------|---------|------|---------|---------|------|
| 1 | v0.1.1-dev-01 | dev | 开发 | **S0 Scaffold & Clean**：`constants.ts` 增量、`tools/jev-mock/` 骨架、依赖与打包面登记。详见 `400-build` §3.1 | ★★☆☆☆ | 1h | `npm run compile` 零错误；仿真端点可起服并通过健康检查 | ✅ |
| 2 | v0.1.1-dev-02 | dev | 设计 | **S1 Contract & ADR**：ADR-006/007 核对回填、`03` 失败面按上游实测补 `400`/`403` 归类、**`model` 固定为 `jev-1.13.0`**、冻结 `secrets` 四签名、**契约仿真端点按实测收紧 + 补鉴权/529 注入**。详见 `400-build` §3.2 | ★★★☆☆ | 1.5h | `03` 纯增量回写完成；无 `jev-latest` 残留；签名与 `02` §2 逐字一致；mock 对上游实测口径逐项对齐且不宽松；契约 lint 零漂移 | ✅ |
| 3 | v0.1.1-dev-03 | dev | 开发 | **S2 Real Client & Mock Worker**：真实 `jevClient`（组装/超时/重试/归一/failure）+ 仿真端点注入面复核 + T2 契约测试骨架（故障全谱 8 个状态码）。详见 `400-build` §3.3 | ★★★★☆ | 3h | T2 故障全谱 + 超时 + 重试 + Key 泄漏断言全绿；T1 基线不降 | ✅ |
| 4 | v0.1.1-dev-04 | dev | 开发 | **S3 Standard Finalization**：新增 `harness/calibrate.ts` 校准工具（`--latency` 耗时曲线 / `--live` 真实端点）、并发 4 复核、**真实端点复核（条件式：超时 / `noul` 分布与阈值复核 / schema 漂移）**、`endpoint` 契约核对、第一批翻牌（T2 证据）。详见 `400-build` §3.4 | ★★★☆☆ | 1.5h | 两条校准数据均留痕；翻牌集合（`ERR-01`~`05` / `API-01` / `INV-04`）完成且可追溯；真实端点复核「有则记录、无则显式跳过」 | ✅ |
| 5 | v0.1.1-dev-05 | dev | 开发 | **S4 Ingress Migration**：`secrets.ts`、`endpoint` 归一、`setApiKey` 命令、**并发编排与 `InspectionReport`（`items` / `degraded` / `skipped`）**、装配层换真实依赖。详见 `400-build` §3.5 | ★★★☆☆ | 2h | `GUARD-01/02/06` 全绿；`setApiKey` 三路径（写入/取消/清除）单测通过；报告三字段行为契约全绿 | ✅ |
| 6 | v0.1.1-dev-06 | dev | 开发 | **S5 Egress Migration**：宽限两态（一次性引导 + 状态栏瞬时）、降级聚合提示、`04` §2 对齐。详见 `400-build` §3.6 | ★★★☆☆ | 1.5h | 宽限 / 降级 / 清单三路径真机可走通 | ✅ |
| 7 | v0.1.1-dev-07 | dev | 测试 | **S6 Guards & Tests**：6 条守卫（新增 `guard:06` Key 泄漏扫描、`guard:03` 补 `500`/`150` 字面量）+ T1（≥107 例 / 12 文件）+ T2 补**上游侧并发峰值与端到端预算**断言 + 契约 lint；无运行期日志。详见 `400-build` §3.7 | ★★★☆☆ | 2h | `guard` / `test:unit` / `test:integration` / lint 全绿；两层基线只增不降 | ✅ |
| 8 | v0.1.1-dev-08 | dev | 发布 | **S7 Verification & Close**：真机八项验收（对仿真端点）、`.vsix`、合并保留历史 + tag `v0.1.1`、Issue 收口。详见 `400-build` §3.8 | ★★☆☆☆ | 1h | `200-spec` §2 八项验收全过；tag 已推送；上架与真机校准 `[DEFERRED]` 已登记 | ⬜ |

> 状态：⬜ 待开始 / 🔄 进行中 / ✅ 已完成 / ❌ 已取消

> - dev 工作包以 **Step**（S0–S7）为原子单位组织，不可再拆分为步骤级。每个 Step 引用 `400-build.md` §3 对应小节获取内部步骤。
> - 仅**执行态为「执行」**的 Step 生成工作包；本版全部 Step 执行态均为「执行」，无 `⏭️ SKIPPED`，故 8 个 dev 工作包全部排程。
> - dev 工作包完成定义 = 代码 + 部署 + 联调。部署/联调归 dev，不归 qa；qa 只验收已部署 + 已联调的功能。
> - 环节取值：调研 / 定位 / 设计 / 规格 / 开发 / 构建 / 部署 / 联调 / 测试 / 发布。市场验证环节（营销 / 调研）排最前，dev / qa 工作包排在其后。
> - **合计预估工时：13.5h**（dev 13.5h；`v0.1.0` 的 research-01（人工 review 时间基线）已 `[DEFERRED]` 至真实判定质量指标可用时，本版不排调研包）。

## 3. 执行记录（Step 完成即追加，append-only）

> 精简规则：每条 ≤ 8 行 · 每段一行 · 无内容写「无」 · 不抄 200 验收与 400 步骤 ·
> 无偏差且改动 ≤1 文件的 Step 压成一行 · 跳过（`⏭️ SKIPPED`）的 Step 不记录。
> 日常流水进 worklog（时间轴），本节只记 Step 轴的偏差 / 发现 / 失误 / 遗留。
> 条目随 Step 完成动态追加，**不编号**（Step 可能跳过，编号会失真）。

#### S0 Scaffold & Clean（e246195）

- **概要**：为真实客户端备好常量、仿真端点与依赖面——`constants.ts` 增 5 个判定参数常量，`tools/jev-mock/` 落地 `03` §2.1 的可执行镜像（平台无关 handler + Node 入口 + Worker 入口 + wrangler 配置），打包面显式排除 `tools/`（验证：compile 零错误 · 五类故障实测符合预期 · guard 全绿 · T1 51 例 / 8 文件未降 · 打包面无 `src/ test/ tools/`）
- **偏差**：`REQUEST_TIMEOUT_MS` 由开工稿 400ms 改为 **500ms**——依据 2026-10-06 真实端点实测（会话首请求 429ms、稳态 152–213ms），400ms 会在冷启动误触发 `ERR-02`；已回写 `03` §2.1 与 `400-build` §3.1（`ADR-007` 预案路径：只动 `constants.ts` 与 `03` 注记）
- **发现**：① 双 question 并行几乎零延迟成本（1q 中位 174ms vs 2q 190ms，输出 token 21→84），印证 `03` §2.1 单请求双 question 设计；② `noul` 判定对 `state` 噪声极敏感（同一段鉴权代码，干净 state 得 0.97、`diff_hunk` 填充噪声后降至 0.26）→ 结构化 `instructions` 由「可选」升为 S2 必需项；③ 真实 `choice` 响应带 `confidence` 与完整 `probabilities`，与 `03` §2.1 逐字一致，仿真端点 schema 有基准可对
- **失误**：无
- **遗留**：T2 契约测试待 S2/S6 落地（`test:integration` 现为显式占位）；O2 埋点仍整体顺延；仿真端点的 `disconnect` 在 Worker 形态退化为 `599` + 标记头，`ERR-01` 断言以 Node 形态为准

#### S1 Contract & ADR（99ef421）

- **概要**：一次性收口「契约面补齐 + 签名冻结 + 仿真端点与上游对齐」——`03` 失败面补 `400` / `403` 与「错误体不解析」注记、`secrets` 四签名冻结（**不建空壳文件**，实现随 S4）、`model` 固定 `jev-1.13.0` 核对、mock 按实测收紧并补 3 个注入（验证：契约 lint 全绿 · mock 8 故障 + 7 类校验拒绝逐项与上游一致 · 答案自洽性通过 · compile / guard / T1 51 例全绿）
- **偏差**：S1 范围经确认扩容（1h → 1.5h）——① 契约面补 `400` / `403` ② 仿真端点按上游实测收紧 ③ `model` 由别名改为固定 ID；三者同属「契约一致性」，与 S1 的 Step 性质同源，且均须在 S2 之前完成
- **发现**：① 真实上游错误面比原登记**多两个状态码**（`400` 用法错误 / `403` 未带 Key 头——**无 header 是 403、Key 错才是 401**）；② 上游明确建议**生产固定版本 ID**，别名漂移会使按分布校准的阈值失效；③ `noul` **不返回 `confidence`**（不确定性由概率自身承载，`≈0.5` 表示自述不确定），我方实现与之一致
- **失误**：无
- **遗留**：T2 契约测试待 S2 / S6 落地（`test:integration` 现为显式占位）；mock 的 `usage` 与判定值为**确定性占位值**，真实分布由 S3 真实端点校准采集

#### S2 Real Client & Mock Worker（8eac40d）

- **概要**：`infra/jevClient` 从本地 mock 换成真实 HTTP 客户端——wire 组装（结构化 `instructions` + 反引号字段引用 + `noul` 的 `true/false` criteria）、固定模型 ID、`AbortController` 超时、`429`/`529` 重试一次、八类状态码归一为 `ERR-01`~`05`；`DecisionResult` 纯增量 `failure`，**恒 resolve 不抛**（保住「部分成功」）。mock 打分移入 `test/fixtures/` 作夹具；**T2 契约测试首次落地**（验证：T1 75 例 / 9 文件（棘轮 51→75）· T2 11 例全绿 · 重试次数从上游侧 `/stats` 断言 · 超时实测 507ms · Key 不入载荷端到端断言 · guard / compile / 契约 lint 全绿 · 打包面无泄漏）
- **偏差**：① 装配层暂用占位依赖（`endpoint` 取默认、`getApiKey` 返回 `null`）以保持可编译，`S4` 换成 `sonecheck.endpoint` 与 `infra/secrets`——否则 S2 无法在「客户端已重写、装配未做」之间保持绿灯；② T1/T2 拆成两份 vitest 配置（`vitest*.config.mts`），单配置无法让 `npm test` 干净聚合两层
- **发现**：① 契约实现时发现 `03` §2.4 把 `CONFIG_CHANGE` / `HIGH_FANOUT` 标为 `v0.1.1`，与 `200-spec` §1.1 / `05` §2.2 的**顺延**登记矛盾——已按后两者修正为 `v0.2.0`（客户端只发 5 项 criteria）；② `.vscodeignore` 的 `vitest.config.*` 漏配新增的 `vitest.integration.config.mts`，已被 `vsce ls` 抓到并修正为 `vitest*.config.mts`；③ 重试次数只能从**上游侧**观察——为此给 mock 加了 `/stats`
- **失误**：新增的「响应缺 `noul`」用例首版用 `undefined` 覆盖，解构默认值把字段填回导致假失败，改为显式构造缺字段
- **遗留**：响应 `model` 的运行期留痕随 O2 顺延（本版以 T2 断言 + S3 真实校准确认「响应版本 = 固定 ID」）；`riskEngine` 的并发编排与 `failure` 剔除归 `S4`

#### S3 Standard Finalization（248fc80）

- **概要**：造出校准工具并跑出两条数据 + 完成第一批翻牌——`harness/calibrate.ts` 落地（`--latency` / `--live` 双模式），样本采集抽为 `samples.ts` 供 `measure.ts` 与 `calibrate.ts` 共用；翻牌 `INV-04` 与 `ERR-01`~`ERR-05`（以 T2 11 例为证据）。耗时曲线（12 块 / 并发 4）：50ms→164ms、100ms→317ms、200ms→626ms，**全部在 p95 ≤ 1s 内**且与「波数 × 单请求」理论吻合
- **偏差**：① 修复 `v0.1.0` 遗留的 `measure.ts`——它自 S2 起已破损（仍从 `src/infra` 导入已移出的 `scoreHunk`），S2 记录里「Harness 产出分布」实际发生在 S2 之前；② 新增 `harness/vscode-shim.cjs`（dev-only）让脚本能在 Node 下运行——Facade 桶文件会传递引入 `configSource` → 需要只在扩展宿主存在的 `vscode` 模块；把 `configSource` 改注入式属 S4 范围，不为脚本提前改分层纪律
- **发现**：① **真实端点 36 次调用 0 次误触发超时**（p50 169–238ms、p90 240–399ms、观测最大 426ms，距 500ms 上限余量 15%–37% 属薄余量）；② **真实 `noul` 分布同样双峰**（低峰 0.03–0.19 / 高峰 0.42–0.97，`0.2`–`0.4` 为谷）→ `RISK_THRESHOLD = 0.4` 落在谷的高侧，**维持不调**；③ **端到端预算有块数边界**：24 块（6 波）≈1.2s 超出 p95 ≤ 1s，预算成立前提是单次检查 ≲16 块——已写入 `200-spec` §2
- **失误**：首版 `takePayloads` 取样本前缀，717 个历史 hunk 把 6 个构造高风险样本挤出 → 命中率失真；改为跨来源交替抽样后重测
- **遗留**：阈值能否下调到谷底（≈0.3）需**带标签样本**判定（当前样本无标签，无法区分假阴 / 假阳）→ 归 S7 真机观察；超时薄余量在 S7 多轮真机中复核；「全部超时」的降级路径端到端约 1.5s（3 波 × 500ms），属降级而非正常路径，不破 `INV-04`

#### S4 Ingress Migration（6c70d82）

- **概要**：输入侧一次接通——`infra/secrets.ts` 落地（`createSecrets(SecretStoragePort)` 暴露 S1 冻结的四签名，**零 `vscode` import**）；`sonecheck.endpoint` 入 `CFG-01` 并做回环感知归一；`sonecheck.setApiKey` 注册 + 抽出可注入纯流程 `runSetApiKey`；`inspect()` 出口改为 `InspectionReport{items, degraded, skipped}` 并以游标 worker 池并发 ≤4 保序聚合；装配层换真实依赖（验证：`compile` / `guard` / T1 **99 例 / 11 文件**（棘轮 75→99）/ T2 11 例 / 契约 lint 全绿 · `grep jevApiKey src/` 仅命中 `secrets.ts` · `grep console.log src/` 无输出 · 打包面仅 LICENSE/README/package.json + out）
- **偏差**：① `03` 原文「`sonecheck.endpoint` 须为 https」与 `200-spec` §2 的仿真端点验收环境冲突（`local.mjs` 是 `http://127.0.0.1:8787`）——按字面执行会把 T2 与 S7 的验收端点一起回退，故澄清为「http 仅允许本机回环」（**澄清式纯增量，无编号变更**）；② `ERR-10` 契约原写「真机验证（原生输入框不可在纯 Node 复现）」，本步把 `API-03` 流程抽为可注入纯函数后**改为单测覆盖**，证据强于原要求
- **发现**：① 契约里 `ERR-08` 的可执行验证含「产生一次性引导」，而引导与「未配置 Key」状态栏瞬时态按版本计划归 **S5**——翻牌时已把验证列精化为 S4 实际证据并显式标注 S5 待办，避免虚假「已兑现」；② 深度相等断言（`test/config.test.ts`）在 `SoneCheckConfig` 增字段后必然破裂——属契约面扩展的必然代价，已同步期望而非放宽断言
- **失误**：① `SetApiKeyDeps` 误用 `Promise` 而 `showInputBox` 返回 `Thenable`，编译期报 `TS2739`/`TS2322`——改为 `PromiseLike`（与 `SecretStoragePort` 一致）；② `test/secrets.test.ts` 的 `INV-03` 用例先 `clearApiKey()` 再断言存储内容，顺序颠倒导致假失败——调整断言顺序
- **遗留**：S5 补「未配置 Key」状态栏瞬时态 + 每会话至多一次的一次性引导 + 降级聚合文案（当前为最小可测文案）；`GUARD-06`（Key 泄漏守卫）脚本落盘归 S6，本步已保证代码形态满足其判定条件

#### S5 Egress Migration（4ccf480）

- **概要**：输出侧呈现补齐——`ui/status` 增 `no-key` 瞬时态（**无错误色**：宽限非故障）；`ui/commands` 按 `InspectionReport` 三支分发（宽限 → 会话级一次性引导 + 状态栏 / 清单非空 → **有效结果优先**、关闭清单后再提示降级 / 全失败 → 不弹清单仅聚合提示）；`FAILURE_LABELS` 给出五类可读归因；`04` §2 增「一次性引导通知」「降级聚合提示」两行并对齐状态栏文案（验证：`compile` / `guard` / T1 **107 例 / 12 文件**（棘轮 99→107）/ T2 11 例 / 契约 lint 全绿 · `grep console.log src/` 无输出 · 打包面仅 LICENSE/README/package.json + out）
- **偏差**：无（`04` §2 为本步 SSOT 对齐面，属澄清式修订；输出通道一行显式标注随 O2 顺延至 `v0.2.0`，避免读者误以为本版有日志）
- **发现**：① 降级归因的人类可读标签必须落在 **UI 层**（`04` §2 是文案 SSOT），`core` 只给 `code` + `count`——归因与呈现的边界在 S4 的 `InspectionReport` 设计里已定，本步只是把它落到代码；② `JevFailureCode` 含 `ERR-08` 但它走宽限分支永不入 `degraded`，故 `FAILURE_LABELS` 用 `Partial<Record<…>>` 而非穷尽映射——**类型系统如实反映了业务事实**，未用空标签凑满
- **失误**：`FAILURE_LABELS` 初版声明为穷尽 `Record<JevFailureCode, string>` 导致编译期 `TS2741`（缺 `ERR-08`）；`NoKeyDeps.guide` 误用 `Promise` 而 `showInformationMessage` 返回 `Thenable` → 编译期两错，均改为 `Partial` 与 `PromiseLike` 后转绿
- **遗留**：引导的一次性粒度为**扩展会话**（内存标记、不持久化，重载窗口后可再引导）——若真机验证认为「每次重载都提示」仍偏吵，改为「配置项静默标记」归后续版本；`GUARD-06` 脚本落盘归 S6

#### S6 Guards & Tests（596ac02）

- **概要**：门禁闭环——`guard:06` 落盘（Key 泄漏扫描，守 `INV-03`）并入聚合；`guard:03` 字面量清单补 `500` / `150`；T2 补**上游侧并发峰值 + 端到端预算**断言；两层基线棘轮更新为 T1 **107 例 / 12 文件**、T2 **12 例**（验证：`guard:01`~`06` **逐条 ✓** · `compile` 零错误 · T1 107/12 · T2 12/1 · 契约 lint 全绿 · `grep -rn "console.log" src/` 无输出 · 打包面无泄漏）
- **偏差**：`400-build` §1.4 的 `GUARD-03` 清单原写 `400`，与 S3 实测定案（`500ms`）不一致——守卫按**现行契约**实现为 `500`，同时回写 §1.4 表格；这类「计划表滞后于已定案值」在后续 Step 需一并复核
- **发现**：① **并发峰值只能从上游侧证明**——客户端无法自证「我的请求重叠了几个」，故给 mock 加 `inFlight` 峰值计数，T2 用专用实例（避免与其它用例的峰值混淆）断言 `peak ≤ 4 且 > 1`；这是「真并发 + 真 HTTP」唯一能同时被验证的层（T1 的并发断言用的是 stub，只证明引擎扇出）；② `console.` 的粗放 grep 会误报 `https://console.typesafe.ai/keys` 这个 URL 字符串——DoD 判据须用精确的 `console.log`，已在 §6 固化为该命令
- **失误**：抽取 `handler.mjs` 的 `route()` 时（为给并发计数包一层 `try/finally`）连撞两错——① 函数声明结尾误留 `};` 触发 `SyntaxError`；② `latencyMs` 是 `createHandler` 闭包变量，提取后成为 `ReferenceError`，起服即失败、T2 整文件 12 例 skipped。两错均由「T2 全 skipped + 手动起服看 stderr」在提交前拦下
- **遗留**：无（`GUARD-06` 已落盘并入聚合；Marketplace 上架与真实端点校准的挂账项同前）
