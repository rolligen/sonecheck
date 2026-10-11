/**
 * S3 校准工具（`400-build` §3.4 步骤 1）。
 *
 * 两条测量链，输入完全一致（共用 `harness/samples.ts` 的样本与 payload 组装）：
 *
 *   npx tsx harness/calibrate.ts --latency 100   # 仿真端点 + 注入延迟 → 并发 4 的耗时曲线
 *   npx tsx harness/calibrate.ts --live         # 真实端点 → 真实 noul 分布 / 阈值复核 / schema 漂移
 *
 * 可选：`--blocks <n>`（默认 12）· `--concurrency <n>`（默认 4，取 `02` §4 既定值）·
 * `--endpoint <url>`（覆盖端点）· `--key-file <path>`（默认 `~/.sonecheck/jev-api-key`）
 *
 * Dev-only, one-shot script: not part of the packaged extension, never imported by
 * `src/`. 真实 Key 只从仓库外读取，**任何输出都不含 Key**。
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { JEV_ENDPOINT_DEFAULT, JEV_MODEL_ID, MAX_CONCURRENCY, REQUEST_TIMEOUT_MS, RISK_THRESHOLD } from '../src/constants';
import { createJevClient } from '../src/infra';
import type { DecisionPolicy, DecisionResult, HunkPayload } from '../src/infra';

import { percentile, takePayloads } from './samples';

const MOCK_PATH = fileURLToPath(new URL('../../tools/jev-mock/local.mjs', import.meta.url));
const ENDPOINT_BUDGET_MS = 1000; // 00 §3：端到端 p95 ≤ 1s

const POLICY: DecisionPolicy = { sensitivePathPatterns: ['auth', 'payment', 'migration'], riskThreshold: RISK_THRESHOLD };

interface Options {
  live: boolean;
  latency: number | null;
  blocks: number;
  concurrency: number;
  endpoint: string | null;
  keyFile: string;
}

interface Observation {
  model: string | null;
  answerKeys: string[];
  hasUsage: boolean;
}

interface CallRecord {
  ms: number;
  result: DecisionResult;
}

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    live: false,
    latency: null,
    blocks: 12,
    concurrency: MAX_CONCURRENCY,
    endpoint: null,
    keyFile: `${process.env.HOME ?? ''}/.sonecheck/jev-api-key`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => argv[(index += 1)];
    if (arg === '--live') options.live = true;
    else if (arg === '--latency') options.latency = Number.parseInt(next(), 10);
    else if (arg === '--blocks') options.blocks = Number.parseInt(next(), 10);
    else if (arg === '--concurrency') options.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--endpoint') options.endpoint = next();
    else if (arg === '--key-file') options.keyFile = next();
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.live && options.latency === null) {
    out('用法：--latency <ms>（对仿真端点测耗时曲线）或 --live（对真实端点测判定分布）');
    process.exitCode = 1;
    return;
  }

  const payloads = takePayloads(options.blocks);
  if (payloads.length === 0) {
    out('无样本（harness/samples.ts 采集为空），无法校准。');
    process.exitCode = 1;
    return;
  }

  const apiKey = options.live ? readKey(options.keyFile) : 'calibration-placeholder-key';
  const observations: Observation[] = [];

  let mock: ChildProcess | null = null;
  let endpoint = options.endpoint ?? JEV_ENDPOINT_DEFAULT;
  if (!options.live) {
    const port = await freePort();
    mock = spawn(process.execPath, [MOCK_PATH], {
      env: { ...process.env, PORT: String(port), MOCK_LATENCY_MS: String(options.latency ?? 0) },
      stdio: 'ignore',
    });
    endpoint = `http://127.0.0.1:${port}/v1/systemone`;
    await waitForHealth(`http://127.0.0.1:${port}/health`);
  }

  const client = createJevClient({
    endpoint,
    getApiKey: async () => apiKey,
    policy: POLICY,
    fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      try {
        const body = (await response.clone().json()) as Record<string, unknown>;
        observations.push({
          model: typeof body.model === 'string' ? body.model : null,
          answerKeys: Object.keys((body.answers ?? {}) as Record<string, unknown>),
          hasUsage: body.usage !== undefined,
        });
      } catch {
        // 非 JSON 响应（错误路径）不参与 schema 观测
      }
      return response;
    },
  });

  out(`# S3 校准 — ${options.live ? '真实端点' : `仿真端点（注入延迟 ${options.latency}ms）`}`);
  out();
  out(`- 样本：${payloads.length} 块（与 harness/samples.ts 同源）· 并发上限：${options.concurrency}`);
  out(`- 端点：${options.live ? endpoint : '本地契约仿真端点'}`);
  out(`- 当前阈值：RISK_THRESHOLD = ${RISK_THRESHOLD} · 单请求超时上限：${REQUEST_TIMEOUT_MS}ms · 端到端预算：${ENDPOINT_BUDGET_MS}ms`);
  out();

  const started = Date.now();
  const records = await runWithConcurrency(payloads, options.concurrency, client.decide.bind(client));
  const wall = Date.now() - started;

  try {
    report(records, wall, options, observations);
  } finally {
    mock?.kill();
  }
}

function readKey(path: string): string {
  if (!existsSync(path)) {
    out(`❌ 未找到 Key 文件：${path}`);
    out('   真实端点校准需要 Key（https://console.typesafe.ai/keys 获取），请放在仓库外并 chmod 600。');
    process.exitCode = 1;
    throw new Error('missing key');
  }
  const key = readFileSync(path, 'utf8').trim();
  if (key === '') {
    out(`❌ Key 文件为空：${path}`);
    process.exitCode = 1;
    throw new Error('empty key');
  }
  return key;
}

async function runWithConcurrency(
  payloads: HunkPayload[],
  limit: number,
  decide: (payload: HunkPayload) => Promise<DecisionResult>,
): Promise<CallRecord[]> {
  const records: CallRecord[] = new Array(payloads.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= payloads.length) return;
      const started = Date.now();
      const result = await decide(payloads[index]);
      records[index] = { ms: Date.now() - started, result };
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker()));
  return records;
}

function report(
  records: CallRecord[],
  wall: number,
  options: Options,
  observations: Observation[],
): void {
  const latencies = records.map((record) => record.ms).sort((a, b) => a - b);
  const failures = records.filter((record) => record.result.failure !== undefined);

  out('## 耗时');
  out();
  out(`- 单请求 min ${latencies[0]}ms · p50 ${percentile(latencies, 0.5)}ms · p90 ${percentile(latencies, 0.9)}ms · max ${latencies[latencies.length - 1]}ms`);
  out(`- 端到端（${records.length} 块 / 并发 ${options.concurrency}）：**${wall}ms** ${wall <= ENDPOINT_BUDGET_MS ? '✓ 在预算内' : '✗ 超出 p95 ≤ 1s 预算'}`);
  out(`- 触发 ERR-02（超时）的块数：${records.filter((record) => record.result.failure === 'ERR-02').length}`);
  out();

  if (failures.length > 0) {
    out('## 失败面');
    out();
    for (const [code, count] of countBy(failures.map((record) => record.result.failure as string))) {
      out(`- ${code}：${count} 块`);
    }    out();
  }

  const scores = records.filter((record) => record.result.failure === undefined).map((record) => record.result.score).sort((a, b) => a - b);
  if (scores.length > 0) {
    const hits = scores.filter((score) => score >= RISK_THRESHOLD).length;
    out('## 判定分布（noul）');
    out();
    out(`- min ${scores[0].toFixed(3)} · p50 ${percentile(scores, 0.5).toFixed(3)} · p90 ${percentile(scores, 0.9).toFixed(3)} · max ${scores[scores.length - 1].toFixed(3)}`);
    out(`- 当前阈值 ${RISK_THRESHOLD} 的命中：${hits}/${scores.length}（${((hits / scores.length) * 100).toFixed(1)}%）`);
    out();
    out('| 区间 | 块数 |');
    out('|---|---|');
    for (let bucket = 0; bucket < 10; bucket += 1) {
      const low = bucket / 10;
      const high = low + 0.1;
      const count = scores.filter((score) => score >= low && (bucket === 9 ? score <= high : score < high)).length;
      if (count > 0) out(`| ${low.toFixed(1)}–${high.toFixed(1)} | ${count} |`);
    }
    out();
  }

  if (options.live) {
    out('## 上游一致性');
    out();
    const models = new Set(observations.map((observation) => observation.model));
    out(`- 响应 model：${[...models].join(', ') || '(无观测)'}　期望 ${JEV_MODEL_ID} → ${models.size === 1 && models.has(JEV_MODEL_ID) ? '✓ 一致' : '⚠️ 漂移'}`);
    const incomplete = observations.filter(
      (observation) => !observation.answerKeys.includes('risk_score') || !observation.answerKeys.includes('reason_code'),
    );
    out(`- answers 含 risk_score + reason_code：${incomplete.length === 0 ? '✓ 全部响应齐备' : `✗ ${incomplete.length} 条缺字段`}`);
    out(`- usage 字段：${observations.every((observation) => observation.hasUsage) ? '✓ 全部存在' : '⚠️ 部分缺失'}`);
    out();
  }
}

function countBy(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(healthUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(healthUrl)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`mock endpoint did not come up at ${healthUrl}`);
}

void main();
