/**
 * 契约仿真处理器 —— `docs/03_CONTRACTS_AND_API.md` §2.1 的可执行镜像。
 *
 * 平台无关、零依赖：Cloudflare Worker（`worker.mjs`）与 Node `http`（`local.mjs`）
 * 共用本文件，保证「测试用的端点」与「真机验收用的端点」行为一致。
 *
 * 权威：请求 / 响应 / 错误码全集以 `03` §2.1 为准，本文件只实现其子集；
 * 真实上游（`https://docs.typesafe.ai/api`）为准入基准，本仿真端点不重定义上游语义。
 */

/** 仿真响应声明的模型版本，与 `03` §2.1 响应示例一致。 */
export const MOCK_MODEL = 'jev-1.13.0';

/** 故障注入头名（见 `300-design` §4.6）。 */
export const FAULT_HEADER = 'x-jev-mock-fault';

/** 传输层故障标记头：Worker 运行时无法真正断连时用于显式声明差异。 */
export const TRANSPORT_MARKER_HEADER = 'x-jev-mock-transport';

/** 支持的五类故障注入，逐一对应 `03` §2.1 的失败面。 */
export const SUPPORTED_FAULTS = ['disconnect', 'timeout', 'http500', 'rate429', 'badschema'];

/** `timeout` 故障的挂起时长：显著大于 `REQUEST_TIMEOUT_MS`（500ms），确保客户端先超时。 */
const TIMEOUT_HOLD_MS = 3000;

/** 正常路径的确定性答案：T2 断言的是「wire 与归一」，不是模型语义。 */
const NOMINAL_NOUL = 0.9;
const NOMINAL_SCORE = 1;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ latencyMs?: number }} [options] `latencyMs` 为注入的固定延迟（S3 耗时曲线用）
 * @returns {(request: Request) => Promise<Response | { kind: 'disconnect' }>}
 */
export function createHandler({ latencyMs = 0 } = {}) {
  return async function handle(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, model: MOCK_MODEL, faults: SUPPORTED_FAULTS, latencyMs });
    }

    if (url.pathname !== '/v1/systemone') return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const fault = request.headers.get(FAULT_HEADER);
    if (fault !== null && !SUPPORTED_FAULTS.includes(fault)) {
      return json({ error: 'unsupported_fault', fault }, 400);
    }

    if (latencyMs > 0) await sleep(latencyMs);

    switch (fault) {
      case 'disconnect':
        // 真断连只能由传输层执行：Node 侧 destroy socket，Worker 侧退化为 599 + 标记头。
        return { kind: 'disconnect' };
      case 'timeout':
        await sleep(TIMEOUT_HOLD_MS);
        return json({ late: true }, 200);
      case 'http500':
        return json({ error: 'internal' }, 500);
      case 'rate429':
        return json({ error: 'rate_limited' }, 429);
      case 'badschema':
        return malformedResponse();
      default:
        return compliantResponse(await readRequestBody(request));
    }
  };
}

/** 校验必填字段；缺字段即 422（对应 `ERR-05` 的请求侧分支）。 */
async function readRequestBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { invalid: true };
  }
  if (body === null || typeof body !== 'object') return { invalid: true };
  const { state, questions } = body;
  if (state === undefined || questions === undefined) return { invalid: true };
  if (questions === null || typeof questions !== 'object' || Object.keys(questions).length === 0) {
    return { invalid: true };
  }
  return { body };
}

function compliantResponse(read) {
  if (read.invalid) return json({ error: 'unprocessable', detail: 'state / questions required' }, 422);

  const { body } = read;
  const answers = {};

  for (const [id, question] of Object.entries(body.questions)) {
    if (question === null || typeof question !== 'object' || typeof question.type !== 'string') {
      return json({ error: 'unprocessable', detail: `question ${id} lacks type` }, 422);
    }
    answers[id] = answerFor(id, question);
  }

  return json({
    model: MOCK_MODEL,
    answers,
    usage: { input_tokens: 288, output_tokens: 20 },
  });
}

function answerFor(id, question) {
  switch (question.type) {
    case 'noul':
      return { type: 'noul', noul: NOMINAL_NOUL };
    case 'choice': {
      const options = Object.keys(question.criteria ?? {});
      const chosen = options[0] ?? 'UNKNOWN';
      const probabilities = Object.fromEntries(options.map((key) => [key, key === chosen ? 1 : 0]));
      return { type: 'choice', choice: chosen, probabilities, confidence: NOMINAL_NOUL };
    }
    case 'score': {
      const levels = Array.isArray(question.criteria) ? question.criteria : [];
      const legend = Object.fromEntries(levels.map((level, index) => [String(index), level]));
      return {
        type: 'score',
        score: NOMINAL_SCORE,
        legend,
        probabilities: Object.fromEntries(Object.keys(legend).map((key) => [key, key === '0' ? 1 : 0])),
        confidence: NOMINAL_NOUL,
      };
    }
    default:
      return { type: question.type };
  }
}

/** 故意不合规：`noul` 缺值 + `choice` 落在枚举外 → 客户端应归 `ERR-05`。 */
function malformedResponse() {
  return json({
    model: MOCK_MODEL,
    answers: {
      risk_score: { type: 'noul' },
      reason_code: { type: 'choice', choice: 'NOT_IN_ENUM' },
    },
    usage: { input_tokens: 288, output_tokens: 20 },
  });
}
