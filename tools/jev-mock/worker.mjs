/**
 * Cloudflare Worker 入口 —— 契约仿真端点的可部署形态。
 *
 * 部署（需 Cloudflare 账号）：`npx wrangler deploy --config tools/jev-mock/wrangler.toml`
 * 本地 workerd：`npx wrangler dev --config tools/jev-mock/wrangler.toml`
 *
 * 与 Node 版（`local.mjs`）的唯一差异：Worker 运行时无法真正切断已建立的连接，
 * 故 `disconnect` 故障退化为 `599` + 显式标记头，由调用方按平台分支断言。
 */

import { createHandler, TRANSPORT_MARKER_HEADER } from './handler.mjs';

const handle = createHandler();

export default {
  async fetch(request) {
    const result = await handle(request);

    if (result instanceof Response) return result;

    return new Response(JSON.stringify({ error: 'transport_disconnected', simulated: true }), {
      status: 599,
      headers: { 'content-type': 'application/json', [TRANSPORT_MARKER_HEADER]: '1' },
    });
  },
};
