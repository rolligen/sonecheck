/**
 * Node 入口 —— 零依赖的契约仿真端点（T2 契约测试与 S7 真机验收的默认形态）。
 *
 *   node tools/jev-mock/local.mjs
 *   PORT=9000 MOCK_LATENCY_MS=120 node tools/jev-mock/local.mjs
 *
 * 与 Worker 版（`worker.mjs`）共用 `handler.mjs`；本入口额外具备**真断连**能力
 * （`disconnect` 故障直接 destroy socket），因此 T2 的 `ERR-01` 断言以本端点为准。
 */

import { createServer } from 'node:http';

import { createHandler } from './handler.mjs';

const port = Number(process.env.PORT ?? 8787);
const latencyMs = Number(process.env.MOCK_LATENCY_MS ?? 0);
const handle = createHandler({ latencyMs });

const server = createServer((incoming, outgoing) => {
  void serve(incoming, outgoing).catch((error) => {
    outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'mock_failure', detail: String(error) }));
  });
});

async function serve(incoming, outgoing) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);

  const request = new Request(`http://${incoming.headers.host ?? '127.0.0.1'}${incoming.url}`, {
    method: incoming.method,
    headers: incoming.headers,
    body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });

  const result = await handle(request);

  // 真断连：客户端 fetch 会抛 TypeError，对应 `ERR-01`。
  if (!(result instanceof Response)) {
    incoming.socket.destroy();
    return;
  }

  outgoing.writeHead(result.status, Object.fromEntries(result.headers));
  outgoing.end(Buffer.from(await result.arrayBuffer()));
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`jev-mock listening on http://127.0.0.1:${port} (latencyMs=${latencyMs})\n`);
});
