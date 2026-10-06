# `jev-mock` — 契约仿真端点

`docs/03_CONTRACTS_AND_API.md` §2.1 的**可执行镜像**：`v0.1.1` 用它替代真实上游做
T2 契约测试与 S7 真机验收。扩展侧代码一行不假（真 `fetch`、真超时、真退避），
只是端点可换。

**契约权威**：`03` §2.1（上游语义以 <https://docs.typesafe.ai/api> 为准入基准）。
本目录只实现其子集，不重定义上游。

## 运行

```bash
# 零依赖（推荐给 T2 与日常验收；具备真断连能力）
node tools/jev-mock/local.mjs
# 注入固定延迟（S3 耗时曲线用）
MOCK_LATENCY_MS=120 node tools/jev-mock/local.mjs
# 换端口
PORT=9000 node tools/jev-mock/local.mjs

# 真实 workerd 运行时 / Cloudflare Worker（**可选**，wrangler 按需拉取，不入项目依赖）
npx wrangler@^4 dev    --config tools/jev-mock/wrangler.toml
npx wrangler@^4 deploy --config tools/jev-mock/wrangler.toml
```

健康检查：`curl http://127.0.0.1:8787/health`

## 故障注入

请求头 `x-jev-mock-fault: <值>`，逐一对应 `03` §2.1 的失败面：

| 值 | 上游状态码 | 仿真行为 | 客户端应归 |
|---|---|---|---|
| `disconnect` | —（连接层） | Node 版直接切断连接；Worker 版退化为 `599` + `x-jev-mock-transport: 1` | `ERR-01`（以 Node 版断言） |
| `timeout` | —（本地计时） | 挂起 3s 后返回（远超 `REQUEST_TIMEOUT_MS = 500`） | `ERR-02` |
| `http500` | `500` | 返回 `internal_error` | `ERR-03` |
| `unauthorized` | `401` | 返回 `authentication_error`（对应「Key 错误」） | `ERR-04` |
| `forbidden` | `403` | 返回 `authentication_error`（对应「未带 Key 头」） | `ERR-04` |
| `rate429` | `429` | 返回 `rate_limit_error`（恒定，用于断言重试次数） | `ERR-04` |
| `rate529` | `529` | 返回 `overloaded_error` | `ERR-04` |
| `badschema` | `200` 但不合规 | 缺字段 + 枚举外取值 | `ERR-05` |

未知取值返回 `400 unsupported_fault`——避免「拼错故障名却静默通过」的假绿灯。

## 请求校验（严格度对齐 2026-10-06 真实端点实测）

mock **不比上游宽松**——客户端写错的请求必须在 mock 上就被拒，否则契约测试会假绿：

| 请求缺陷 | mock 响应 | 真实上游实测 |
|---|---|---|
| 缺 `model` / `state` / `questions` | `422`（`detail` 逐字段数组） | `422` |
| `questions` 为空对象 / 非对象 | `422` | `422` |
| 未知 `question.type` | `400 api_usage_error` | `400 api_usage_error` |
| `choice` 缺 `criteria` 或为空 | `422` | `422` |
| `score` 缺 `criteria` 或为空 | `422` | `422` |
| `noul` 既无 `instructions` 也无 `criteria` | `400`（`Noul question must have criteria or instructions`） | `400`（同一措辞） |
| body 非法 JSON | `400 api_usage_error` | `400` |

`model` **只校验必填、不校验取值**——上游允许发送未列于 `GET /v1/models` 的固定版本 ID。

## 答案取值说明

`usage`（`{input_tokens: 288, output_tokens: 20}`）与判定值（`noul = 0.9` 等）是**确定性占位值**：契约测试断言的是 **wire 形态与错误归一**，不是模型判定分布——真实分布由 S3 的真实端点校准采集。

占位值与所声称的形态**自洽**：`choice.confidence` 按上游公式 $(p_{max} - 1/n)/(1 - 1/n)$ 导出；`score` 为概率加权级别值且 `confidence` 与分布一致。**不会**出现「概率全压在选项上却报 `confidence: 0.9`」这类会误导下游的组合。

## 指向它

扩展设置 `"sonecheck.endpoint": "http://127.0.0.1:8787/v1/systemone"`。

## 纪律

- **本端点忽略 `Authorization` 头**：任何测试都**不需要真实 API Key**；鉴权失败路径由 `unauthorized` / `forbidden` 注入覆盖。
- 真实 Key 只放 `~/.sonecheck/jev-api-key`（`600`），**严禁**进入仓库任何文件
  （含 `.dev.vars` / `wrangler.toml` / `.env`）。
- 本目录**不进 `.vsix`**（`extension/.vscodeignore` 已登记）。

## 平台能力差异

| 能力 | `local.mjs`（Node） | `worker.mjs`（Worker） |
|---|---|---|
| 真断连（`ERR-01`） | ✅ destroy socket | ❌ 退化为 `599` + 标记头 |
| 延迟注入 | ✅ `MOCK_LATENCY_MS` | ✅ `wrangler dev` 亦支持 |
| 需要账号 | 否 | 部署需要 Cloudflare 账号 |

因此：**T2 的 `ERR-01` 断言以 `local.mjs` 为准**；Worker 形态用于「从另一台机器连」
的真机验收。
