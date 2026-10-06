# sonecheck - UI / UX 设计

> **适用说明**：本文为**可选文档**。纯后端 / CLI / 库类项目**自动跳过**，不生成。
> 本项目为 VS Code 扩展（有用户界面），故生成；界面**全部由 VS Code 原生控件构成**（QuickPick / 通知 / 状态栏），无 Webview、无自定义视觉层。
> **文档流向纪律**：本文档继承引用 upstream `00_PRODUCT_REQUIREMENTS.md`、`02_SYSTEM_DESIGN.md` 与 `03_CONTRACTS_AND_API.md`；**不引用下游，也不声明下游引用方**（引用方向严格单向）。
> **占位符约定**：`{{FIELD}}` = 结构化命名字段；`<!-- TODO: [dm-init-docs] <说明> -->` = 待补充内容。

---

## 1. 交互流程

主用户路径（手动触发，Happy Path）：

| 步骤 | 页面 / 视图 | 用户动作 | 系统响应 |
|------|-------------|----------|----------|
| 1 | 任意编辑器 | `Cmd/Ctrl+Shift+P` → `SoneCheck: Inspect Staged Diff` | 状态栏进入「检查中」，全程不阻塞输入 |
| 2 | 无改动 | — | 通知「无暂存改动」，流程结束 |
| 3 | 全为低风险 | — | 状态栏短暂显示 `SoneCheck: All Clear`，无弹窗（US-03） |
| 4 | 存在高风险 | QuickPick 清单（Top-K，默认 3 条） | 每条显示 `[score] 文件:行 · reason` |
| 5 | QuickPick 清单 | 点击某一条 | 打开对应文件，光标定位到该 hunk 起始行 |
| 6 | QuickPick 清单 | `Esc` 关闭 | 不改变任何状态，流程结束 |

**清单条目文案（本文为文案 SSOT）**：`[score] 文件:行 · reason`，其中 `reason` 的显示文案如下（机器取值见 `03` §2.4）：

| `reason_code` | 显示文案 |
|---------------|----------|
| `AUTH_BOUNDARY` | 鉴权边界 |
| `DATA_WRITE` | 数据写入 |
| `CONTRACT_BREAK` | 契约破坏 |
| `ERROR_HANDLING` | 错误处理 |
| `STYLE_ONLY` | 样式改动 |

> `score` 以两位小数呈现（如 `[0.42]`）；条目文案保持单行短句（`04` §3.3「动态字号」）。

> 首次使用路径：命令面板 → `SoneCheck: Set Jev API Key` → 输入框（`password: true`，不回显）→ 写入 SecretStorage。

---

## 2. 视图状态

> 每个视图须覆盖**空 / 加载 / 成功 / 错误 / 降级**五态，避免状态缺失导致白屏或静默失败。

| 视图 | 空 | 加载 | 成功 | 错误 | 降级 |
|------|----|------|------|------|------|
| 状态栏（`ui/status`） | 无暂存改动：显示 `SoneCheck: 无改动` 后恢复 | 显示 `SoneCheck: 检查中…`（spinner） | 显示 `All Clear` 2s 后恢复 | `ERR-06/09`：显示一次错误并恢复 | `ERR-01~04`：显示 `SoneCheck: 已跳过（服务不可用）`；未配置 Key（`ERR-08`）：显示 `SoneCheck: 未配置 Key` 后恢复 |
| QuickPick 清单（`ui/riskList`） | **不弹出**（零打扰，US-03） | 不适用（清单仅在判定完成后弹出） | 列出 Top-K 风险项，可键盘选择 | `ERR-05`：不合规项被丢弃，剩余项照常展示 | 同「空」：降级时不弹出清单 |
| 密钥输入框（`ui/commands`） | `ERR-10` 取消：无操作 | 不适用 | 写入成功并提示「已保存」 | `ERR-11` 空串：二次确认后清除 | 不适用 |
| 输出通道（`ui/logger` → Output Channel） | 无日志时保持空白 | 实时追加 | 结构化日志可读 | 记录 `ERR-*` 原因码 | 记录降级原因与耗时 |

> 错误与降级态须有可观测留痕，判据见 `06_OBSERVABILITY.md`。
>
> 未配置 Key 的**首次**引导为一次性通知（带「设置 Key」按钮，直达 `sonecheck.setApiKey`），检查静默跳过、不进错误态；**后续**仅状态栏短暂提示——宽限跳过语义见 `ADR-006`。

---

## 3. 设计令牌与组件规范

### 3.1 设计令牌（Design Token）

> **本项目无自定义视觉层**：界面使用 VS Code 原生控件（QuickPick / Notification / StatusBarItem），颜色、字号、间距**全部由 VS Code 主题系统与用户设置决定**，扩展不得覆写。
> 因此本项目**不建立** Primitive / Semantic / Component 三层令牌，也**不引入**令牌文件 —— 该豁免即本节对本项目的落地方式（原模板三层结构不适用）。

| 层 | 本项目取值 / 来源 |
|----|-------------------|
| **Primitive** 基础层 | 不适用（由 VS Code 主题提供） |
| **Semantic** 语义层 | 映射到原生控件语义：`StatusBarItem.warningBackground` / `errorBackground`；QuickPick 使用主题默认前景背景 |
| **Component** 组件层 | 不适用（无自绘组件） |

- **令牌文件（SSOT 载体）**：**本项目无**——界面全部使用 VS Code 原生控件，不存在自绘视觉层，故不引入 `tokens.json`。若后续引入 Webview，须按 `dev-meta/docs/09-ai-architecture-guide.md` §7 补三层令牌。
- **红线**：即使引入主题色，也**禁止**在扩展内硬编码颜色字面量（如 `#ff0000`）；须经 `ThemeColor` API 引用主题令牌。
- 规范与红线见 `dev-meta/docs/09-ai-architecture-guide.md` §7。

### 3.2 组件清单

| 组件 | 用途 | 入参 | 状态 | 复用范围 |
|------|------|------|------|----------|
| `createStatusBarItem` | 检查进度与结果的短提示 | 文案、`ThemeColor` 语义 | 空闲 / 进行中 / All Clear / 降级 | 全局单例 |
| `window.showQuickPick` | 风险条目清单与选择 | `RiskItem[]`、占位文案 | 有项 / 空（不弹出） | 单次检查 |
| `window.showInformationMessage` | 一次性提示（无改动 / 降级） | 文案、可选按钮 | 一次性 | 全局 |
| `window.showInputBox` | API Key 录入 | `password: true` | 正常 / 取消 / 空串 | 一次性 |
| `window.showWarningMessage` | 降级 / 清除 Key 二次确认 | 文案、确认按钮 | 一次性 | 全局 |
| `window.showTextDocument` + `revealRange` | 条目跳转定位 | `Uri`、行列 | 成功 / 失败 | 单次选择 |

### 3.3 可访问性与动效下限

> 阈值**引用 WCAG 2.2 AA**，不在本文重定义。

| 项 | 要求 | 本项目落地方式 |
|----|------|----------------|
| 对比度 | 正文 / 大字达 WCAG 2.2 AA | 由 VS Code 主题保证；不自绘文本 |
| 动态字号 | 支持系统字号缩放，不截断 | 由原生控件保证；条目文案保持单行短句 |
| 无障碍标签 | 交互元素有可读标签 / 语义角色 | QuickPick 项 `label` + `description` 语义清晰；状态栏 `name` 已设置 |
| 动效降级 | 尊重 `prefers-reduced-motion` | 无自定义动效；仅原生 spinner |
| 键盘可达 | 全流程可纯键盘完成 | 命令面板 / QuickPick 原生支持方向键与 `Esc` |

---

## 4. 与契约的对接

| 界面元素 | 依赖契约 | 失败时表现 |
|----------|----------|------------|
| 风险清单条目 | `03` §2.1 Response（`score` / `reason_code`） | `ERR-05`：丢弃该条，不出现在清单 |
| 清单跳转定位 | `03` §1 `INV-06` | 定位失败不得展示该条（禁止死链） |
| API Key 输入框 | `03` §2.3（`API-03`）、§3（`CFG-01`） | `ERR-10` 取消 / `ERR-11` 空串二次确认 |
| 降级提示 | `03` §4 `ERR-01`–`ERR-04` + `INV-04` | 静默放行 + 一次性提示，绝不阻断提交 |
| 状态栏「无改动」 | `03` §4 `ERR-07` | 提示一次后恢复 |

---

## 5. AI 执行检查清单

> **用途**：S4（Ingress）/ S5（Egress）UI 接入时**逐项核对**。每项均对应「AI 会违反、且违反后无人能自动发现」的行为约束（准入线见 `dev-meta/docs/09-ai-architecture-guide.md` §7.0）。

| # | 检查项 | 判据来源 | 可否自动校验 |
|---|--------|----------|--------------|
| 1 | 未硬编码任何颜色 / 字号字面量，主题色一律经 `ThemeColor` | 本文 §3.1 红线 | ✅ 正则扫描 |
| 2 | 视图覆盖**空 / 加载 / 成功 / 错误 / 降级**五态 | 本文 §2 | 🟡 人工对照 |
| 3 | 错误与降级态**有留痕**，无静默吞错 | `dev-meta/docs/07-observability-driven-dev.md` §2.5 | 🟡 人工 / 日志检查 |
| 4 | UI 不自持业务状态（检查状态机归 `core`） | `02` §4（状态机定义）+ `dev-meta/docs/09-ai-architecture-guide.md` §3.4 | 🟡 人工 Review |
| 5 | 对比度 / 动态字号 / 无障碍标签达标 | WCAG 2.2 AA | ✅ 原生控件 + 人工抽查 |
| 6 | 无常驻动画；若有须支持 `prefers-reduced-motion` | WCAG 2.2 AA | ✅ 代码扫描 |
| 7 | **禁跨层取数**：UI 不得直接调 git / HTTP（只经 `core` Facade） | `dev-meta/docs/09-ai-architecture-guide.md` §2 单向分层 | 🟡 人工 Review |
| 8 | 清单条目 100% 可跳转，无死链 | 本文 §4 + `INV-06` | ✅ 断言 / 真机 |
| 9 | API Key 输入使用 `password: true` 且任何提示文案不含 Key | `INV-03` | ✅ 代码审查 |

---

## 6. 引用声明

| 引用对象 | 方向 | 用途 |
|----------|------|------|
| `00_PRODUCT_REQUIREMENTS.md` | upstream | 用户故事与验收 |
| `02_SYSTEM_DESIGN.md` | upstream | 检查状态机（§4）—— 本文 §5 检查项 4 的判据 |
| `03_CONTRACTS_AND_API.md` | upstream | 接口契约与错误码 |
| `06_OBSERVABILITY.md` | 关联 | 错误 / 降级留痕落点 |
| `dev-meta/docs/09-ai-architecture-guide.md` §7 | 外部权威 | 设计令牌规范与准入线（只引用，不重定义） |

> 方向取值：`upstream`（本文引用它）/ `外部权威`（只引用不重定义）/ `关联`（无层级关系的互补文档）。
