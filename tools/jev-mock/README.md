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

请求头 `x-jev-mock-fault: <值>`，五类逐一对应 `03` §2.1 的失败面：

| 值 | 仿真行为 | 客户端应归 |
|---|---|---|
| `disconnect` | Node 版直接切断连接；Worker 版退化为 `599` + `x-jev-mock-transport: 1` | `ERR-01`（以 Node 版断言） |
| `timeout` | 挂起 3s 后返回（远超 `REQUEST_TIMEOUT_MS = 500`） | `ERR-02` |
| `http500` | 返回 `500` | `ERR-03` |
| `rate429` | 返回 `429`（恒定，用于断言重试次数） | `ERR-04` |
| `badschema` | 返回缺字段 + 枚举外取值的响应 | `ERR-05` |

未知取值返回 `400 unsupported_fault`——避免「拼错故障名却静默通过」的假绿灯。

## 指向它

扩展设置 `"sonecheck.endpoint": "http://127.0.0.1:8787/v1/systemone"`。

## 纪律

- **本端点忽略 `Authorization` 头**：任何测试都**不需要真实 API Key**。
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
