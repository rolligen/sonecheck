import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JEV_MODEL_ID, MAX_CONCURRENCY, REQUEST_TIMEOUT_MS, RETRY_MAX_ATTEMPTS } from '../../src/constants';
import { createRiskEngine, normalizeConfig } from '../../src/core';
import { createJevClient, readSourceLines, readStagedDiff, resolveRepoRoot } from '../../src/infra';
import type { DecisionPolicy, DecisionResult, HunkPayload } from '../../src/infra';

/**
 * T2 contract tests — the decision call crosses a process boundary.
 *
 * The endpoint is the real HTTP surface of `tools/jev-mock/` (a faithful
 * mirror of `03` §2.1, verified against the live service on 2026-10-06), so
 * timeouts, retries and connection failures are the genuine article rather than
 * a stubbed promise. Faults are selected through the mock's out-of-band
 * `x-jev-mock-fault` header, injected by a thin `fetch` wrapper — the client
 * itself knows nothing about it.
 *
 * Retry counts are asserted from the **upstream side** (`GET /stats`), because
 * that is the only place "did we really send it twice" is observable.
 */

const MOCK_PATH = fileURLToPath(new URL('../../../tools/jev-mock/local.mjs', import.meta.url));
const KEY = 'apikey_integration_secret';

const policy: DecisionPolicy = { sensitivePathPatterns: ['auth'], riskThreshold: 0.4 };

const payload: HunkPayload = {
  filePath: 'src/auth/login.ts',
  changeType: 'MODIFY',
  diffHunk: '@@ -1,2 +1,3 @@\n+  if (!token) return null;',
  contextCode: 'export function login() {\n  return true;\n}',
};

interface MockStats {
  total: number;
  byFault: Record<string, number>;
  inFlight: { current: number; peak: number };
  lastRequest: Record<string, unknown> | null;
}

let server: ChildProcess;
let endpoint: string;

beforeAll(async () => {
  const port = await freePort();
  endpoint = `http://127.0.0.1:${port}/v1/systemone`;

  server = spawn(process.execPath, [MOCK_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });

  const health = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(health);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await delay(100);
  }
  throw new Error(`mock endpoint did not come up at ${health}`);
});

afterAll(() => {
  server?.kill();
});

describe('API-01 正常路径', () => {
  it('合规响应解析为判定结果，decision 本地派生', async () => {
    const result = await decide();

    expect(result).toEqual({ score: 0.9, decision: 'AUDIT', reasonCode: 'AUTH_BOUNDARY' });
  });

  it('端到端幂等：同一 payload 两次调用结果完全相等', async () => {
    expect(await decide()).toEqual(await decide());
  });

  it('出站请求体符合 03 §2.1：固定模型 + snake_case state + 两 question', async () => {
    await decide();
    const { lastRequest } = await stats();

    expect(lastRequest?.model).toBe(JEV_MODEL_ID);
    expect(Object.keys(lastRequest?.state as object).sort()).toEqual([
      'change_type',
      'context_code',
      'diff_hunk',
      'file_path',
    ]);

    const questions = lastRequest?.questions as Record<string, { type: string }>;
    expect(questions.risk_score.type).toBe('noul');
    expect(questions.reason_code.type).toBe('choice');
  });

  it('Key 不出现在请求体中（INV-03 的端到端证据）', async () => {
    await decide();
    const { lastRequest } = await stats();

    expect(JSON.stringify(lastRequest)).not.toContain(KEY);
  });
});

describe('失败面降级（ERR-01 ~ ERR-05）', () => {
  it('ERR-01 连接被切断 → 放行，不抛错', async () => {
    const { result, delta } = await withFault('disconnect');

    expect(result.failure).toBe('ERR-01');
    expect(delta).toBe(1);
  });

  it('ERR-02 超时 → 在超时上限内放弃，不重试', async () => {
    const before = Date.now();
    const { result, delta } = await withFault('timeout');
    const elapsed = Date.now() - before;

    expect(result.failure).toBe('ERR-02');
    expect(elapsed).toBeGreaterThanOrEqual(REQUEST_TIMEOUT_MS - 100);
    expect(elapsed).toBeLessThan(700);
    expect(delta).toBe(1);
  });

  it('ERR-03 其他非 2xx（500）→ 放行', async () => {
    const { result, delta } = await withFault('http500');

    expect(result.failure).toBe('ERR-03');
    expect(delta).toBe(1);
  });

  it('ERR-04 鉴权失败（401 / 403）→ 放行且不重试', async () => {
    for (const fault of ['unauthorized', 'forbidden'] as const) {
      const { result, delta } = await withFault(fault);

      expect(result.failure).toBe('ERR-04');
      expect(delta).toBe(1);
    }
  });

  it('ERR-04 容量受限（429 / 529）→ 恰好重试一次后放行', async () => {
    for (const fault of ['rate429', 'rate529'] as const) {
      const { result, delta } = await withFault(fault);

      expect(result.failure).toBe('ERR-04');
      expect(delta).toBe(RETRY_MAX_ATTEMPTS + 1);
    }
  });

  it('ERR-05 响应不合规 → 丢弃该块，其余不受影响', async () => {
    const { result } = await withFault('badschema');

    expect(result.failure).toBe('ERR-05');
  });

  it('所有失败路径都以「放行」收尾：score 0、PASS、不抛异常（INV-01/INV-04）', async () => {
    for (const fault of ['disconnect', 'http500', 'unauthorized', 'rate429', 'badschema']) {
      const { result } = await withFault(fault as string);

      expect(result).toMatchObject({ score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY' });
      expect(result.failure).toBeDefined();
    }
  });
});

/** A client bound to the mock, optionally injecting a fault out-of-band. */
function clientWith(fault?: string) {
  return createJevClient({
    endpoint,
    getApiKey: async () => KEY,
    policy,
    fetchImpl: (url, init) =>
      fetch(url, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          ...(fault === undefined ? {} : { 'x-jev-mock-fault': fault }),
        },
      }),
  });
}

async function decide(): Promise<DecisionResult> {
  return clientWith().decide(payload);
}

/** Run one decision under a fault and report how many requests the mock saw. */
async function withFault(
  fault: string,
): Promise<{ result: DecisionResult; delta: number }> {
  const before = await stats();
  const result = await clientWith(fault).decide(payload);
  const after = await stats();

  return { result, delta: (after.byFault[fault] ?? 0) - (before.byFault[fault] ?? 0) };
}

async function stats(): Promise<MockStats> {
  const base = endpoint.replace('/v1/systemone', '');
  const response = await fetch(`${base}/stats`);

  return (await response.json()) as MockStats;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Concurrency + end-to-end budget, against a dedicated mock instance.
 *
 * A separate instance is deliberate: the shared one accumulates a peak across
 * every earlier test, and this assertion needs a count nobody else touched. It
 * is also the only layer where "real concurrency" and "real HTTP" are verified
 * **together** — T1 proves the engine's fan-out with a stub, T2 proves the
 * upstream never sees more than `MAX_CONCURRENCY` requests at once.
 */
describe('并发与端到端预算（真并发 + 真 HTTP）', () => {
  const LATENCY_MS = 100;
  const BLOCKS = 12; // 3 waves at concurrency 4
  const BUDGET_MS = 1000; // 00 §3 end-to-end p95

  let slowServer: ChildProcess;
  let slowEndpoint: string;
  let repo: string;

  beforeAll(async () => {
    const port = await freePort();
    slowEndpoint = `http://127.0.0.1:${port}/v1/systemone`;
    slowServer = spawn(process.execPath, [MOCK_PATH], {
      env: { ...process.env, PORT: String(port), MOCK_LATENCY_MS: String(LATENCY_MS) },
      stdio: 'ignore',
    });
    await waitForHealth(`http://127.0.0.1:${port}/health`);
    repo = createRepoWithChanges(BLOCKS);
  });

  afterAll(() => {
    slowServer?.kill();
    if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
  });

  it(`在飞请求不超过 ${MAX_CONCURRENCY}，且 ${BLOCKS} 块端到端仍在 ${BUDGET_MS}ms 预算内`, async () => {
    const engine = createRiskEngine({
      resolveRepoRoot,
      readStagedDiff,
      readSourceLines,
      hasApiKey: async () => true,
      createClient: (clientPolicy) =>
        createJevClient({ endpoint: slowEndpoint, getApiKey: async () => KEY, policy: clientPolicy }),
    });

    const started = Date.now();
    const report = await engine.inspect(normalizeConfig({ maxItems: 20 }), repo);
    const elapsed = Date.now() - started;

    const base = slowEndpoint.replace('/v1/systemone', '');
    const observed = (await (await fetch(`${base}/stats`)).json()) as MockStats;

    expect(report.items).toHaveLength(BLOCKS);
    expect(report.degraded).toEqual([]);
    // 上游侧观测：并发确实发生了，且从未超过上限
    expect(observed.inFlight.peak).toBeGreaterThan(1);
    expect(observed.inFlight.peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
    // 3 波 × 100ms ≈ 300ms；顺序调用会是 12 × 100 = 1200ms（超预算）
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

/** A temp git repo with `count` staged single-line changes. */
function createRepoWithChanges(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'sonecheck-t2-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'SoneCheck T2'], { cwd: dir });
  mkdirSync(join(dir, 'src', 'util'), { recursive: true });
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(dir, 'src', 'util', `mod${index}.ts`), `export const v${index} = ${index};\n`);
  }
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(dir, 'src', 'util', `mod${index}.ts`), `export const v${index} = ${index + 1};\n`);
  }
  execFileSync('git', ['add', '.'], { cwd: dir });
  return dir;
}

async function waitForHealth(healthUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(healthUrl)).ok) return;
    } catch {
      // not listening yet
    }
    await delay(100);
  }
  throw new Error(`mock endpoint did not come up at ${healthUrl}`);
}
