import { describe, expect, it } from 'vitest';
import { createMockJevClient, scoreHunk } from '../src/infra';
import type { DecisionPolicy, HunkPayload } from '../src/infra';

const policy: DecisionPolicy = { sensitivePathPatterns: ['auth', 'payment', 'migration'], riskThreshold: 0.8 };

function payloadOf(overrides: Partial<HunkPayload> = {}): HunkPayload {
  return {
    filePath: 'src/app.ts',
    changeType: 'MODIFY',
    diffHunk: '@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;',
    contextCode: 'const a = 1;',
    ...overrides,
  };
}

describe('scoreHunk', () => {
  it('敏感路径命中时归因为 AUTH_BOUNDARY 且得分不少于该维度权重', () => {
    const result = scoreHunk({ payload: payloadOf({ filePath: 'src/auth/login.ts' }), policy });

    expect(result.reasonCode).toBe('AUTH_BOUNDARY');
    expect(result.score).toBeGreaterThanOrEqual(0.4);
  });

  it('关键词命中按组归因（token → AUTH_BOUNDARY，delete → DATA_WRITE，catch → ERROR_HANDLING）', () => {
    const token = scoreHunk({
      payload: payloadOf({ diffHunk: '@@ -1,1 +1,2 @@\n+const token = issue();' }),
      policy,
    });
    const remove = scoreHunk({
      payload: payloadOf({ diffHunk: '@@ -1,1 +1,2 @@\n+await db.delete(row);' }),
      policy,
    });
    const swallowed = scoreHunk({
      payload: payloadOf({ diffHunk: '@@ -1,1 +1,2 @@\n+  catch (error) {' }),
      policy,
    });

    expect(token.reasonCode).toBe('AUTH_BOUNDARY');
    expect(remove.reasonCode).toBe('DATA_WRITE');
    expect(swallowed.reasonCode).toBe('ERROR_HANDLING');
  });

  it('导出符号改动归因为 CONTRACT_BREAK', () => {
    const result = scoreHunk({
      payload: payloadOf({ diffHunk: '@@ -1,1 +1,2 @@\n+export function login() {' }),
      policy,
    });

    expect(result.reasonCode).toBe('CONTRACT_BREAK');
  });

  it('纯样式改动得低分且归因 STYLE_ONLY', () => {
    const result = scoreHunk({
      payload: payloadOf({ diffHunk: '@@ -1,1 +1,1 @@\n-const a =  1;\n+const a = 1;' }),
      policy,
    });

    expect(result.reasonCode).toBe('STYLE_ONLY');
    expect(result.decision).toBe('PASS');
    expect(result.score).toBeLessThan(policy.riskThreshold);
  });

  it('空 diff 恒返回 0 分 / PASS / STYLE_ONLY，不抛错', () => {
    const result = scoreHunk({ payload: payloadOf({ diffHunk: '' }), policy });

    expect(result).toEqual({ score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY' });
  });

  it('四维全命中时合成得分为 1（上边界）', () => {
    const lines = [
      '+export function auth() {',
      '+  const token = password;',
      '+  session.save();',
      '+  delete cache;',
      '+  db.transaction(() => {});',
      '+  try { auth(); } catch (error) {}',
      ...Array.from({ length: 30 }, (_, index) => `+  pad${index}();`),
    ].join('\n');
    const result = scoreHunk({
      payload: payloadOf({ filePath: 'src/auth/login.ts', diffHunk: `@@ -1,1 +1,36 @@\n${lines}` }),
      policy,
    });

    expect(result.score).toBe(1);
    expect(result.decision).toBe('AUDIT');
    expect(result.reasonCode).toBe('AUTH_BOUNDARY');
  });

  it('合成得分被截断在 [0, 1]', () => {
    const huge = Array.from({ length: 200 }, (_, index) => `+export const value${index} = token;`).join('\n');
    const result = scoreHunk({
      payload: payloadOf({ filePath: 'src/auth/login.ts', diffHunk: `@@ -1,1 +1,200 @@\n${huge}` }),
      policy,
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.decision).toBe('AUDIT');
  });

  it('decision 采用大于等于语义', () => {
    const strict: DecisionPolicy = { ...policy, riskThreshold: 0 };
    const result = scoreHunk({ payload: payloadOf(), policy: strict });

    expect(result.decision).toBe('AUDIT');
  });

  it('decide 幂等：同一 payload 两次调用结果完全相等', async () => {
    const client = createMockJevClient(policy);
    const payload = payloadOf({ filePath: 'src/auth/login.ts' });

    expect(await client.decide(payload)).toEqual(await client.decide(payload));
  });
});
