# Jev API 全文参考（上游快照）

> **性质**：TypeSafe **上游 API 的只读快照**，供本项目查字段、查错误码、查语义时**不必联网**。
> **不是本项目的契约**——我方契约以 [`docs/03_CONTRACTS_AND_API.md`](../03_CONTRACTS_AND_API.md) §2.1 为准（只登记本项目使用的子集，不重定义上游语义）。
> **唯一权威**：<https://docs.typesafe.ai/api>（本文与之冲突时以上游为准）。
> **快照日期**：2026-10-06 · 抓取自 `api` / `models` / `confidence` / `introduction/quickstart` 四页 + 10 次真实端点实测。
> **失效处理**：上游变更时不改本文件语义，只更新「实测校准」小节并在提交信息中标注差异；`jev-latest` 指向的模型版本天然会漂移（见 §5）。

---

## 1. 端点与认证

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

| 项 | 值 |
|---|---|
| Key 获取 | 登录 Playground → <https://console.typesafe.ai/keys> 创建 |
| SDK 环境变量 | `TYPESAFE_API_KEY`（本项目不引 SDK，见 `ADR-004`；该变量名仅供脚本化冒烟） |
| Key 基数 | `apikey_<hex>_<hex>` 形态（本项目实测样本） |
| 并发 / 限流 | 文档未公布具体数值；`429` 表示已超限、`529` 表示上游过载 |

---

## 2. 请求体

```json
{
  "state": { "…": "被评估的业务状态" },
  "model": "jev-latest",
  "questions": {
    "<question-id>": { "type": "noul | choice | score", "instructions": "…", "criteria": "…" }
  }
}
```

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `state` | ✅ | string \| object \| array | 被评估的状态。**字符串与结构化对象都支持**（实测确认）。可含应用状态、对话、记录等 |
| `model` | ✅ | string | 见 §5。缺此字段 → **422** |
| `questions` | ✅ | map | 键为自定义 question id，**响应按同键返回**；键不会传给模型、也不参与推理 |

### 2.1 Question 三型

| 型 | `criteria` | 实测/文档约束 | 返回 |
|---|---|---|---|
| `noul` | 可选 `{ "true": "…", "false": "…" }` | 需 `instructions` 或 `criteria` 至少其一，否则 **400** | yes 的概率 `0`–`1` |
| `choice` | **必填** map（option → 描述，值可为 `null`） | 缺 `criteria` → **422**；最多 **255** 个选项 | 选中项 + 完整概率分布 + `confidence` |
| `score` | **必填** 有序数组（级别描述） | 文档称需 ≥2 级、至多 10 级；**实测 1 级也接受** | 概率加权级别值 + `legend` + 分布 + `confidence` |

### 2.2 `instructions` 可结构化（重要）

`instructions` 支持 **string / object / array**；在文本中用**反引号引用 `state` 内的字段名**：

```json
"instructions": {
  "potential_duplicate": { "name": "…", "location": "…" },
  "question": "`potential_duplicate` 与本条记录是否同一人？"
}
```

> 本项目据此把两个 question 的 `instructions` 写成结构化（问题 + 字段引用），并给 `risk_score` 补 `criteria: {true, false}`——实测显示 `noul` 判定对 `state` 噪声高度敏感（同一段代码，干净 state 得 `0.97`，`diff_hunk` 被填充噪声后降至 `0.26`）。详见 `300-design` §4.1。

---

## 3. 响应体

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "<question-id>": { "type": "noul | choice | score", "…": "见下" }
  },
  "usage": { "input_tokens": 296, "output_tokens": 20 }
}
```

| 字段 | 说明 |
|---|---|
| `model` | **实际回答请求的版本化模型 ID**——用于追溯口径变化与审计 |
| `answers` | 每个 question 一条 answer，键与请求同 id；每条 answer 的 `type` 与其 question 一致 |
| `usage` | token 用量（本项目本版不消费） |

| Answer 型 | 字段 |
|---|---|
| `noul` | `type` / `noul`（yes 的概率）——**不返回 `confidence`** |
| `choice` | `type` / `choice` / `probabilities`（各选项概率，和为 1）/ `confidence` |
| `score` | `type` / `score`（概率加权级别值，可落在级别之间）/ `legend`（级别 → 描述）/ `probabilities`（键为级别字符串）/ `confidence` |

---

## 4. 错误

### 4.1 文档列出的错误

| 状态码 | 含义 | 上游建议 |
|---|---|---|
| `401` | Key 缺失或无效 | 检查 `Authorization` 头 |
| `422` | 请求体校验失败（缺字段 / question 畸形） | 响应体指出出错字段 |
| `429` | 超过速率限制 | **退避后重试** |
| `529` | 上游临时过载 | **短暂延迟后重试** |

### 4.2 实测补充（文档未列，但真实存在）

| 状态码 | 触发条件 | 错误体 | 本项目归类 |
|---|---|---|---|
| **`400`** | 未知 `question.type`；`noul` 缺 `instructions` 且无 `criteria` | `{"detail":{"error_type":"api_usage_error","message":"Invalid request."}}` | `ERR-05`（请求不合规，与 422 同类） |
| **`403`** | **完全未带** `Authorization` 头 | `{"detail":{"error_type":"authentication_error","message":"Must supply an API key!"}}` | `ERR-04`（鉴权失败，与 401 同类） |

> 注意：**无 header → 403，Key 错误 → 401**，两者 `error_type` 均为 `authentication_error`。

### 4.3 错误体形态与本项目策略

`detail` 可能是**对象 / 数组 / 字符串**三种形态（如 `422` 返回 pydantic 风格的 `[{type, loc, msg, input}]`）。
**本项目只按状态码归一、不解析 body**——上游改文案不会影响归一逻辑。

---

## 5. 模型与版本

| `model` 取值 | 类型 | 2026-10-06 指向 | 特点 |
|---|---|---|---|
| `jev-1.13.0` | **固定版本 ID** | `jev-1.13.0` | 生产可复现；文档推荐生产固定此 ID |
| `jev-latest` | 浮动别名 | `jev-1.13.0` | 始终指向最新稳定正式版；SDK 默认值 |
| `jev-preview` | 浮动别名 | `jev-1.13.0` | 指向最新发布版（可能含预览版） |

- `GET /v1/models` 返回该账号可用的 `model` 名称、描述与发布日期；**固定 ID 即使不在列表中也可直接发送**。
- 精确版本写作 `jev-1.13.0`（`jev-1.13` 不是有效 ID）。
- **上游明确建议：需要结果可复现时不要用别名**——别名会随新版本自动迁移，客户端不改但**回答会变**，针对旧版本调好的**置信度 / 阈值会失效**。
- 弃用政策：文档**未给出**保证（无弃用通知期 / 下线 SLA 承诺），因此「固定版本 + 主动升级」是更稳的运维姿势。

> 对本项目的含义：判定阈值 `riskThreshold` 是**按分布校准**的，模型漂移会直接使校准失效——故应固定模型 ID，把升级做成一次显式动作（`300-design` §4.1 / `03` §2.1）。

---

## 6. 概率与置信度语义

### 6.1 `noul` 不带 `confidence`

`noul` 只给一个概率 `p`（yes 的概率），**不返回 `confidence`**——不确定性已由 `p` 自身承载：

- `p ≈ 0.5` = 模型自述**不确定**（yes 与 no 各半），**不是**「中等强度」
- 若要与 `choice` 用同一套阈值门控，可自行换算：$$ \text{confidence} = |2p - 1| $$
- 本项目直接对 `noul` 与用户阈值比较（`score >= riskThreshold`），不引入 `confidence`

### 6.2 `choice` / `score` 的 `confidence` 由分布导出

| 型 | 公式 | 含义 |
|---|---|---|
| `choice`（$n$ 选项，$p_{\max}$ 为选中项概率） | $ \frac{p_{\max} - 1/n}{1 - 1/n} $ | 均匀分布 = 0，全压在选项上 = 1；只看最高项 |
| `score`（$n$ 级，$p_i$ 为各级概率，$m$ 为最可能级） | $ \max\left(0,\ 1 - \frac{\sum_i p_i |i-m|}{\text{MAD}_{\text{unif}}}\right) $，其中 $\text{MAD}_{\text{unif}} = \frac1n \sum_i \left|i - \frac{n-1}{2}\right|$ | 概率加权平均「离峰值几级」相对均匀铺开的比值；下界 0 |

- 低 `confidence` 常意味着「没有明显胜出者」或「`state` 信息不足」——可用作路由人工的信号。
- 官方建议的三档处置：**高 → 自动执行；中 → 谨慎推进 / 标记复核；低 → 不动，交人工**。阈值应**随后果严重度缩放**（只读操作与破坏性操作不该用同一个数），并用自己域的数据校准。
- `confidence` 是「分布集中度」的**一个合理汇总**，不是正确性保证；由于每个 answer 都带完整 `probabilities`，也可自选统计量（如 top-1 概率、top1/top2 比值）。

> 本项目本版**不消费 `confidence`**（只用 `noul` 的概率做阈值判定 + `choice` 的选项做归因），此节仅备查。

---

## 7. 实测校准记录（2026-10-06，真实端点）

| # | 请求 | 状态码 | 观测 |
|---|---|---|---|
| 1 | 正常（单 `noul`，鉴权代码片段） | 200 | `noul = 0.97`（语义正确）；`usage` 随输入变化 |
| 2 | 双 question（`noul` + `choice`） | 200 | 中位 **190ms** vs 单 question **174ms**（+16ms；输出 token 21→84）→ **并行提问几乎零延迟成本** |
| 3 | 同一段代码、`diff_hunk` 被填充噪声 | 200 | `noul` 降至 **0.26**（低于阈值 0.4）→ **payload 质量决定判定质量** |
| 4 | 会话内**首个**请求 | 200 | **429ms**（冷 TLS + 预热）→ 400ms 超时预算会误触发 `ERR-02`，故定案 500ms |
| 5–10 | 稳态单 / 双 question 各 5 轮 | 全 200 | 152–213ms；未见 `429` |
| 11 | 无 `Authorization` | **403** | `authentication_error` |
| 12 | 错误 Key | 401 | `authentication_error` |
| 13 | 未知 `question.type` | **400** | `api_usage_error` |
| 14 | `choice` 缺 `criteria` | 422 | `detail` 为数组，指向 `body.questions.<id>.choice.criteria` |
| 15 | 缺 `model` / 缺 `questions` | 422 | 同上（`Field required`） |
| 16 | `noul` 缺 `instructions` 且无 `criteria` | **400** | `"Noul question must have criteria or instructions"` |
| 17 | `score` 只给 1 级 | 200 | **与文档不符**：实际接受，`score = 0.0` |
| 18 | `state` 传字符串 | 200 | 字符串与对象均支持 |
| 19 | `noul` + `criteria{true,false}` | 200 | 结构化 criteria 可用（`noul = 0.65`） |

> 结论沉淀：`03` §2.1（子集契约 + 超时定案）、`tools/jev-mock/`（严格度基准与故障注入面）、`300-design` §4.1（结构化 instructions）、`constants.ts`（`REQUEST_TIMEOUT_MS = 500`）。

---

## 8. 本项目取用子集

**我方契约见 `03` §2.1**（不在此重复）。取用范围：

| 上游能力 | 我方用法 |
|---|---|
| `POST /v1/systemone` + `Bearer` | 采用；endpoint 可经 `CFG-01` `sonecheck.endpoint` 覆盖 |
| `state`（结构化对象） | 采用：四字段 `file_path` / `change_type` / `diff_hunk` / `context_code` |
| `model` | 采用，**固定 `jev-1.13.0`**（上游建议固定 ID 保可复现；理由与升级路径见 `03` §2.1 与本文 §5） |
| `noul`（`risk_score`） | 采用：概率 → `score` |
| `choice`（`reason_code`，5 项 `criteria`） | 采用：`choice` → `reasonCode`；`confidence` / `probabilities` 本版不消费 |
| `score` 原语 | **不采用**（`ADR-005`：有序级别值需再归一到 0–1） |
| `local_metadata` 三字段 | **本版不发送**（顺延，见 `05` §2.2） |
| `usage` / `confidence` | 本版不消费（O2 埋点顺延后可能用于留痕） |
| `400` / `401` / `403` / `422` / `429` / `529` | 全部纳入失败面归一（`ERR-01`~`ERR-05`） |

---

## 9. 快照来源

| 页面 | 地址 |
|---|---|
| API reference | <https://docs.typesafe.ai/api> |
| Models | <https://docs.typesafe.ai/models> |
| Confidence | <https://docs.typesafe.ai/confidence> |
| Quick start | <https://docs.typesafe.ai/introduction/quickstart> |
| 文档索引（llms.txt） | <https://docs.typesafe.ai/llms.txt> |
| 项目内 skill 副本 | `.codebuddy/skills/typesafe-ai/SKILL.md`（方法论指引，API 结构以本文为准） |
