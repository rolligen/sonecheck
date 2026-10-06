import { describe, expect, it } from 'vitest';

import { JEV_MODEL_ID, RETRY_MAX_ATTEMPTS } from '../src/constants';
import { buildJevRequest, classifyHttpFailure, createJevClient, REASON_CODE_RUBRIC } from '../src/infra';
import type { DecisionPolicy, DecisionResult, HunkPayload } from '../src/infra';

/**
 * T1 for the real client: wire assembly, failure normalization and retry
 * policy — all with an injected `fetchImpl`, so no network and no mock server
 * (`01` §3: T1 must not mock the network layer, it simply never leaves Node).
 * The cross-process behaviour is covered by `test/integration/jevContract.test.ts`.
 */

const policy: DecisionPolicy = { sensitivePathPatterns: ['auth'], riskThreshold: 0.4 };
const KEY = 'apikey_test_secret_value';

const payload: HunkPayload = {
  filePath: 'src/auth/login.ts',
  changeType: 'MODIFY',
  diffHunk: '@@ -1,2 +1,3 @@\n+  if (!token) return null;',
  contextCode: 'export function login() {\n  return true;\n}',
};

function answersOf(overrides: Partial<{ noul: unknown; choice: unknown }> = {}): unknown {
  const { noul = 0.91, choice = 'AUTH_BOUNDARY' } = overrides;
  return {
    model: JEV_MODEL_ID,
    answers: {
      risk_score: { type: 'noul', noul },
      reason_code: { type: 'choice', choice, probabilities: { AUTH_BOUNDARY: 1 }, confidence: 1 },
    },
    usage: { input_tokens: 200, output_tokens: 20 },
  };
}

interface StubCall {
  url: string;
  init: RequestInit;
}

/** Build a client over a scripted fetch; returns the recorded calls too. */
function clientOver(
  handler: (call: StubCall, attempt: number) => Promise<Response> | Response,
  apiKey: string | null = KEY,
): { client: ReturnType<typeof createJevClient>; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const client = createJevClient({
    endpoint: 'https://api.example.test/v1/systemone',
    getApiKey: async () => apiKey,
    policy,
    fetchImpl: (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return handler(call, calls.length);
    }) as unknown as typeof fetch,
  });
  return { client, calls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('buildJevRequest', () => {
  it('固定模型版本 ID（不使用浮动别名）', () => {
    expect(buildJevRequest(payload).model).toBe(JEV_MODEL_ID);
    expect(JEV_MODEL_ID).not.toMatch(/latest|preview/);
  });

  it('state 使用 snake_case 四字段，与 03 §2.1 Request 一致', () => {
    expect(Object.keys(buildJevRequest(payload).state).sort()).toEqual([
      'change_type',
      'context_code',
      'diff_hunk',
      'file_path',
    ]);
  });

  it('两个 question 一次并行发出：noul 打分 + choice 归因', () => {
    const { questions } = buildJevRequest(payload);

    expect(questions.risk_score.type).toBe('noul');
    expect(questions.reason_code.type).toBe('choice');
    expect(Object.keys(questions.reason_code.criteria).sort()).toEqual(
      Object.keys(REASON_CODE_RUBRIC).sort(),
    );
  });

  it('instructions 结构化并以反引号引用 state 字段，risk_score 带 true/false criteria', () => {
    const { questions } = buildJevRequest(payload);
    const risk = JSON.stringify(questions.risk_score);

    expect(questions.risk_score.criteria.true).toBeTruthy();
    expect(questions.risk_score.criteria.false).toBeTruthy();
    expect(risk).toContain('`diff_hunk`');
    expect(risk).toContain('`context_code`');
  });

  it('载荷里不含 local_metadata（本版不发送）', () => {
    expect(JSON.stringify(buildJevRequest(payload))).not.toContain('local_metadata');
  });
});

describe('classifyHttpFailure', () => {
  it('400 / 422 归 ERR-05（我们的请求不合规，不是服务故障）', () => {
    expect(classifyHttpFailure(400)).toBe('ERR-05');
    expect(classifyHttpFailure(422)).toBe('ERR-05');
  });

  it('401 / 403 / 429 / 529 归 ERR-04（鉴权与容量）', () => {
    for (const status of [401, 403, 429, 529]) expect(classifyHttpFailure(status)).toBe('ERR-04');
  });

  it('其余非 2xx 归 ERR-03', () => {
    expect(classifyHttpFailure(500)).toBe('ERR-03');
    expect(classifyHttpFailure(503)).toBe('ERR-03');
  });
});

describe('createJevClient', () => {
  it('正常响应：score 与 reasonCode 取自响应，decision 本地派生', async () => {
    const { client } = clientOver(() => jsonResponse(answersOf({ noul: 0.91 })));

    const result = await client.decide(payload);

    expect(result).toEqual({ score: 0.91, decision: 'AUDIT', reasonCode: 'AUTH_BOUNDARY' });
  });

  it('恰好等于阈值计入 AUDIT（>= 语义）', async () => {
    const { client } = clientOver(() => jsonResponse(answersOf({ noul: 0.4 })));

    expect((await client.decide(payload)).decision).toBe('AUDIT');
  });

  it('低于阈值判 PASS，且不携带 failure', async () => {
    const { client } = clientOver(() => jsonResponse(answersOf({ noul: 0.39 })));

    expect((await client.decide(payload)).decision).toBe('PASS');
  });

  it('幂等：同一 payload 两次调用结果完全相等', async () => {
    const { client } = clientOver(() => jsonResponse(answersOf()));

    expect(await client.decide(payload)).toEqual(await client.decide(payload));
  });

  it('响应缺 noul → ERR-05 放行，不抛错', async () => {
    // 显式构造「字段缺失」：不能用 `undefined` 覆盖，解构默认值会把它填回去。
    const { client } = clientOver(() =>
      jsonResponse({
        model: JEV_MODEL_ID,
        answers: {
          risk_score: { type: 'noul' },
          reason_code: { type: 'choice', choice: 'AUTH_BOUNDARY' },
        },
      }),
    );

    expect(await client.decide(payload)).toEqual(passThrough('ERR-05'));
  });

  it('归因落在枚举外 → ERR-05 放行', async () => {
    const { client } = clientOver(() => jsonResponse(answersOf({ choice: 'NOT_IN_ENUM' })));

    expect((await client.decide(payload)).failure).toBe('ERR-05');
  });

  it('noul 越界（>1）→ ERR-05', async () => {
    const { client } = clientOver(() => jsonResponse(answersOf({ noul: 1.4 })));

    expect((await client.decide(payload)).failure).toBe('ERR-05');
  });

  it('400 / 422 不重试（我们的请求写错，重发无意义）', async () => {
    const { client, calls } = clientOver(() => jsonResponse({ detail: {} }, 400));

    expect((await client.decide(payload)).failure).toBe('ERR-05');
    expect(calls).toHaveLength(1);
  });

  it('401 / 403 不重试（鉴权失败不是容量问题）', async () => {
    for (const status of [401, 403]) {
      const { client, calls } = clientOver(() => jsonResponse({ detail: {} }, status));

      expect((await client.decide(payload)).failure).toBe('ERR-04');
      expect(calls).toHaveLength(1);
    }
  });

  it('429 / 529 恰好重试 RETRY_MAX_ATTEMPTS 次后放行', async () => {
    for (const status of [429, 529]) {
      const { client, calls } = clientOver(() => jsonResponse({ detail: {} }, status));

      expect((await client.decide(payload)).failure).toBe('ERR-04');
      expect(calls).toHaveLength(RETRY_MAX_ATTEMPTS + 1);
    }
  });

  it('429 后成功则返回真实判定，不带 failure', async () => {
    const { client, calls } = clientOver((_call, attempt) =>
      attempt === 1 ? jsonResponse({ detail: {} }, 429) : jsonResponse(answersOf({ noul: 0.77 })),
    );

    const result = await client.decide(payload);

    expect(result.score).toBe(0.77);
    expect(result.failure).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('500 → ERR-03', async () => {
    const { client } = clientOver(() => jsonResponse({ detail: {} }, 500));

    expect((await client.decide(payload)).failure).toBe('ERR-03');
  });

  it('连接层异常 → ERR-01，不重试', async () => {
    const { client, calls } = clientOver(() => {
      throw new TypeError('fetch failed');
    });

    expect((await client.decide(payload)).failure).toBe('ERR-01');
    expect(calls).toHaveLength(1);
  });

  it('中止（超时）→ ERR-02，不重试', async () => {
    const { client, calls } = clientOver(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    expect((await client.decide(payload)).failure).toBe('ERR-02');
    expect(calls).toHaveLength(1);
  });

  it('未配置 Key → ERR-08 兜底，且根本不发请求', async () => {
    const { client, calls } = clientOver(() => jsonResponse(answersOf()), null);

    expect(await client.decide(payload)).toEqual(passThrough('ERR-08'));
    expect(calls).toHaveLength(0);
  });

  it('Key 不出现在请求体、URL 与返回值中（INV-03）', async () => {
    const { client, calls } = clientOver(() => jsonResponse(answersOf({ noul: 0.95 })));

    const result: DecisionResult = await client.decide(payload);
    const call = calls[0];

    expect(call.init.body).not.toContain(KEY);
    expect(call.url).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
    // 只允许出现在 Authorization 头里
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });
});

function passThrough(failure: DecisionResult['failure']): DecisionResult {
  return { score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY', failure };
}
