import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRiskEngine, normalizeConfig } from '../src/core';
import { LocalFailure, readSourceLines, readStagedDiff, resolveRepoRoot } from '../src/infra';
import type { DecisionPolicy, DecisionResult, HunkPayload, IJevClient, JevFailureCode } from '../src/infra';
import { createMockJevClient } from './fixtures/jevScoring';
import { MAX_CONCURRENCY } from '../src/constants';

const created: string[] = [];

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sonecheck-engine-'));
  created.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'SoneCheck Test'], { cwd: dir });
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  mkdirSync(join(dir, 'src', 'util'), { recursive: true });
  writeFileSync(join(dir, 'src', 'auth', 'login.ts'), 'export function login() {\n  return true;\n}\n');
  writeFileSync(join(dir, 'src', 'util', 'format.ts'), "export const sep = ':';\n");
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

/** A repo with `count` staged single-line changes, for fan-out assertions. */
function createRepoWithChanges(count: number): string {
  const dir = createRepo();
  for (let index = 0; index < count; index += 1) {
    const file = join(dir, 'src', 'util', `mod${index}.ts`);
    writeFileSync(file, `export const value${index} = ${index};\n`);
  }
  execFileSync('git', ['add', '.'], { cwd: dir });
  return dir;
}

const ioDeps = { resolveRepoRoot, readStagedDiff, readSourceLines };

/** Real IO + the `v0.1.0` mock scorer, i.e. the wiring `extension.ts` performs. */
function engineWith(createClient: (policy: DecisionPolicy) => IJevClient, hasApiKey = true) {
  return createRiskEngine({ ...ioDeps, createClient, hasApiKey: async () => hasApiKey });
}

const engine = engineWith(createMockJevClient);

/** Stub client: records in-flight concurrency and can inject a failure class. */
function stubClient(options: { delayMs?: number; failure?: JevFailureCode } = {}) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const create = (): IJevClient => ({
    async decide(_payload: HunkPayload): Promise<DecisionResult> {
      state.calls += 1;
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      try {
        if (options.delayMs !== undefined) await sleep(options.delayMs);
        if (options.failure !== undefined) {
          return { score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY', failure: options.failure };
        }
        return { score: 0.95, decision: 'AUDIT', reasonCode: 'AUTH_BOUNDARY' };
      } finally {
        state.inFlight -= 1;
      }
    },
  });
  return { create, state };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe('riskEngine.inspect', () => {
  it('敏感路径改动进入清单并归因 AUTH_BOUNDARY', async () => {
    const dir = createRepo();
    writeFileSync(
      join(dir, 'src', 'auth', 'login.ts'),
      'export function login() {\n  if (!token) return null;\n  return true;\n}\n',
    );
    execFileSync('git', ['add', '.'], { cwd: dir });

    const report = await engine.inspect(normalizeConfig({}), dir);

    expect(report.items).toHaveLength(1);
    expect(report.items[0].filePath).toBe('src/auth/login.ts');
    expect(report.items[0].reasonCode).toBe('AUTH_BOUNDARY');
    expect(report.degraded).toEqual([]);
    expect(report.skipped).toBeNull();
  });

  it('纯样式改动不产出条目（零打扰分支）', async () => {
    const dir = createRepo();
    writeFileSync(join(dir, 'src', 'util', 'format.ts'), 'export const sep = ":";\n');
    execFileSync('git', ['add', '.'], { cwd: dir });

    const report = await engine.inspect(normalizeConfig({}), dir);

    expect(report.items).toEqual([]);
    expect(report.degraded).toEqual([]);
  });

  it('无暂存改动时抛出分类失败 ERR-07', async () => {
    const dir = createRepo();

    await expect(engine.inspect(normalizeConfig({}), dir)).rejects.toBeInstanceOf(LocalFailure);
    await expect(engine.inspect(normalizeConfig({}), dir)).rejects.toMatchObject({ code: 'ERR-07' });
  });

  it('enabled=false 时短路返回空报告（不检查、不提示）', async () => {
    const dir = createRepo();
    const { state } = stubClient();
    const off = engineWith(stubClient().create);

    const report = await off.inspect(normalizeConfig({ enabled: false }), dir);

    expect(report).toEqual({ items: [], degraded: [], skipped: null });
    expect(state.calls).toBe(0);
  });

  it('清单项可定位（filePath 与行号在真实文件中存在）', async () => {
    const dir = createRepo();
    writeFileSync(
      join(dir, 'src', 'auth', 'login.ts'),
      'export function login() {\n  if (!token) return null;\n  return true;\n}\n',
    );
    execFileSync('git', ['add', '.'], { cwd: dir });

    const report = await engine.inspect(normalizeConfig({}), dir);
    const root = resolveRepoRoot(dir);

    for (const item of report.items) {
      const lines = readSourceLines(root, item.filePath);
      expect(lines.length).toBeGreaterThanOrEqual(item.startLine);
    }
  });
});

describe('riskEngine.inspect · 降级与宽限', () => {
  it('部分失败：失败块剔除出清单并按 ERR-* 归并计数', async () => {
    const dir = createRepoWithChanges(4);
    // 前 3 块失败、第 4 块成功：验证部分成功不会被整体放弃
    let call = 0;
    const mixed = engineWith(() => ({
      decide: async (): Promise<DecisionResult> => {
        call += 1;
        return call <= 3
          ? { score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY', failure: 'ERR-03' }
          : { score: 0.95, decision: 'AUDIT', reasonCode: 'AUTH_BOUNDARY' };
      },
    }));

    const report = await mixed.inspect(normalizeConfig({ maxItems: 10 }), dir);

    expect(report.items).toHaveLength(1);
    expect(report.degraded).toEqual([{ code: 'ERR-03', count: 3 }]);
    expect(report.skipped).toBeNull();
  });

  it('全部失败：清单为空但降级归因非空（空清单可解释）', async () => {
    const dir = createRepoWithChanges(3);
    const all = engineWith(stubClient({ failure: 'ERR-02' }).create);

    const report = await all.inspect(normalizeConfig({}), dir);

    expect(report.items).toEqual([]);
    expect(report.degraded).toEqual([{ code: 'ERR-02', count: 3 }]);
  });

  it('多类失败：degraded 按 count 降序、同计数按 code 升序（结果可复现）', async () => {
    const dir = createRepoWithChanges(4);
    const codes: JevFailureCode[] = ['ERR-03', 'ERR-03', 'ERR-01', 'ERR-01'];
    let index = 0;
    const mixed = engineWith(() => ({
      decide: async (): Promise<DecisionResult> => {
        const code = codes[index];
        index += 1;
        return { score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY', failure: code };
      },
    }));

    const first = await mixed.inspect(normalizeConfig({}), dir);
    index = 0;
    const second = await mixed.inspect(normalizeConfig({}), dir);

    expect(first.degraded).toEqual([
      { code: 'ERR-01', count: 2 },
      { code: 'ERR-03', count: 2 },
    ]);
    expect(second.degraded).toEqual(first.degraded);
  });

  it('未配置 Key：宽限跳过（skipped=NO_KEY，零请求、不抛异常）', async () => {
    const dir = createRepoWithChanges(3);
    const { create, state } = stubClient();
    const noKey = engineWith(create, false);

    const report = await noKey.inspect(normalizeConfig({}), dir);

    expect(report).toEqual({ items: [], degraded: [], skipped: 'NO_KEY' });
    expect(state.calls).toBe(0);
  });

  it('未配置 Key 优先于本地失败：暂存区为空也返回 skipped 而非 ERR-07', async () => {
    const dir = createRepo();
    const noKey = engineWith(stubClient().create, false);

    const report = await noKey.inspect(normalizeConfig({}), dir);

    expect(report.skipped).toBe('NO_KEY');
  });
});

describe('riskEngine.inspect · 并发', () => {
  it(`在飞请求数不超过 ${MAX_CONCURRENCY}，且总耗时按波数收敛`, async () => {
    const count = MAX_CONCURRENCY * 5; // 5 波
    const dir = createRepoWithChanges(count);
    const { create, state } = stubClient({ delayMs: 50 });

    const started = Date.now();
    const report = await engineWith(create).inspect(normalizeConfig({ maxItems: 20 }), dir);
    const elapsed = Date.now() - started;

    expect(state.calls).toBe(count);
    expect(state.peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
    expect(state.peak).toBeGreaterThan(1);
    // 5 波 × 50ms ≈ 250ms；顺序调用会是 20 × 50 = 1000ms
    expect(elapsed).toBeLessThan(600);
    expect(report.items).toHaveLength(count);
  });

  it('结果按提交顺序聚合：清单顺序不随请求完成顺序变化', async () => {
    const dir = createRepoWithChanges(6);
    const delays = [60, 10, 50, 5, 40, 1];
    let index = 0;
    const staggered = createRiskEngine({
      ...ioDeps,
      hasApiKey: async () => true,
      createClient: () => ({
        decide: async (): Promise<DecisionResult> => {
          const delay = delays[index];
          index += 1;
          await sleep(delay);
          return { score: 0.95, decision: 'AUDIT', reasonCode: 'AUTH_BOUNDARY' };
        },
      }),
    });

    const report = await staggered.inspect(normalizeConfig({ maxItems: 20 }), dir);

    // 请求以乱序完成，条目仍按 diff 顺序（mod0 → mod5）
    expect(report.items.map((item) => item.filePath)).toEqual([
      'src/util/mod0.ts',
      'src/util/mod1.ts',
      'src/util/mod2.ts',
      'src/util/mod3.ts',
      'src/util/mod4.ts',
      'src/util/mod5.ts',
    ]);
  });
});
