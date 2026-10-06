/**
 * 契约仿真处理器 —— `docs/03_CONTRACTS_AND_API.md` §2.1 的可执行镜像。
 *
 * 平台无关、零依赖：Cloudflare Worker（`worker.mjs`）与 Node `http`（`local.mjs`）
 * 共用本文件，保证「测试用的端点」与「真机验收用的端点」行为一致。
 *
 * **严格度基准 = 2026-10-06 对真实端点的实测**（`docs/reference/jev-api.md` §7）：
 * 未知 `question.type` → 400 · `noul` 缺 `instructions` 且无 `criteria` → 400 ·
 * 缺 `model` / `state` / `questions` / `choice.criteria` → 422 · 错 Key → 401 ·
 * 未带 Key 头 → 403 · 429 限流 / 529 过载 → 退避重试。
 * **本端点不得比上游宽松**——宽松会让契约测试假绿（客户端写错的请求在 mock 上通过、在真端点上失败）。
 *
 * 权威：`03` §2.1（我方子集契约）；上游语义以 <https://docs.typesafe.ai/api> 为准入基准。
 */

/** 仿真响应声明的模型版本，与我方请求侧固定 ID 一致（`03` §2.1）。 */
export const MOCK_MODEL = 'jev-1.13.0';

/** 故障注入头名（`300-design` §4.6）。 */
export const FAULT_HEADER = 'x-jev-mock-fault';

/** 传输层故障标记头：Worker 运行时无法真正断连时用于显式声明差异。 */
export const TRANSPORT_MARKER_HEADER = 'x-jev-mock-transport';

/** 上游合法 question 类型白名单。 */
export const QUESTION_TYPES = ['noul', 'choice', 'score'];

/** 支持的故障注入，逐一对应 `03` §2.1 的失败面。 */
export const SUPPORTED_FAULTS = [
  'disconnect', // ERR-01
  'timeout', // ERR-02
  'http500', // ERR-03
  'unauthorized', // ERR-04 (401)
  'forbidden', // ERR-04 (403)
  'rate429', // ERR-04 (429)
  'rate529', // ERR-04 (529)
  'badschema', // ERR-05（响应侧不合规）
];

/** 故障 → 上游状态码 / 错误类型（形态对齐上游，便于人工排查）。 */
const FAULT_STATUS = {
  http500: [500, 'internal_error'],
  unauthorized: [401, 'authentication_error'],
  forbidden: [403, 'authentication_error'],
  rate429: [429, 'rate_limit_error'],
  rate529: [529, 'overloaded_error'],
};

/** `timeout` 故障的挂起时长：显著大于 `REQUEST_TIMEOUT_MS`（500ms），确保客户端先超时。 */
const TIMEOUT_HOLD_MS = 3000;

/**
 * 请求计数（`GET /stats`）。T2 需要断言「恰好重试一次」这类行为，而重试次数只能
 * 从上游侧观察；测试读取**增量**，故不提供 reset。
 */
const requestCounts = { total: 0, byFault: {} };

/**
 * In-flight gauge and its observed peak.
 *
 * Concurrency is only observable from the upstream side — a client cannot prove
 * how many of its requests overlapped. T2 asserts the peak against
 * `MAX_CONCURRENCY` through this counter (the Node entry handles requests
 * concurrently, so the gauge is meaningful).
 */
const inFlight = { current: 0, peak: 0 };

/**
 * 最近一次请求体（`GET /stats` 的 `lastRequest`）。
 *
 * **只记录 body，绝不记录 header**——这样 T2 可以断言「客户端没有把 Key 放进
 * 载荷」（`INV-03`），而 mock 自身也不会成为泄密面。
 */
let lastRequest = null;

/**
 * 正常路径的**确定性占位值**。
 *
 * T2 断言的是「wire 形态与错误归一」，**不断言模型判定分布**——真实分布由 S3 的真实端点
 * 校准步骤采集。占位值必须与所声称的形态**自洽**（见 `choiceConfidence` / `scoreAnswer`）。
 */
const NOMINAL_NOUL = 0.9;
const NOMINAL_USAGE = { input_tokens: 288, output_tokens: 20 };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 上游 `4xx/5xx` 的两种 body 形态：`detail` 为对象，或为逐字段校验数组。 */
const detailError = (errorType, message) => ({ detail: { error_type: errorType, message } });
const detailField = (loc, msg) => ({ detail: [{ type: 'missing', loc, msg, input: undefined }] });

/**
 * @param {{ latencyMs?: number }} [options] `latencyMs` 为注入的固定延迟（S3 耗时曲线用）
 * @returns {(request: Request) => Promise<Response | { kind: 'disconnect' }>}
 */
export function createHandler({ latencyMs = 0 } = {}) {
  return async function handle(request) {
    inFlight.current += 1;
    inFlight.peak = Math.max(inFlight.peak, inFlight.current);
    try {
      return await route(request, latencyMs);
    } finally {
      inFlight.current -= 1;
    }
  };
}

async function route(request, latencyMs) {
  const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        model: MOCK_MODEL,
        questionTypes: QUESTION_TYPES,
        faults: SUPPORTED_FAULTS,
        latencyMs,
      });
    }

    // 请求计数：供 T2 断言重试次数（只读，读增量）。
    if (request.method === 'GET' && url.pathname === '/stats') {
      return json({ ...requestCounts, inFlight: { ...inFlight }, lastRequest, faults: SUPPORTED_FAULTS });
    }

    if (url.pathname !== '/v1/systemone') return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const fault = request.headers.get(FAULT_HEADER);
    if (fault !== null && !SUPPORTED_FAULTS.includes(fault)) {
      return json({ error: 'unsupported_fault', fault }, 400);
    }

    requestCounts.total += 1;
    const faultKey = fault ?? 'none';
    requestCounts.byFault[faultKey] = (requestCounts.byFault[faultKey] ?? 0) + 1;

    if (latencyMs > 0) await sleep(latencyMs);

    if (fault === 'disconnect') {
      // 真断连只能由传输层执行：Node 侧 destroy socket，Worker 侧退化为 599 + 标记头。
      return { kind: 'disconnect' };
    }
    if (fault === 'timeout') {
      await sleep(TIMEOUT_HOLD_MS);
      return json({ late: true }, 200);
    }
    if (fault === 'badschema') {
      return malformedResponse();
    }
    if (fault !== null && fault in FAULT_STATUS) {
      const [status, errorType] = FAULT_STATUS[fault];
      return json(detailError(errorType, mockMessage(fault)), status);
    }

    return compliantResponse(await readRequestBody(request));
}

function mockMessage(fault) {
  switch (fault) {
    case 'unauthorized':
      return 'Cannot authenticate with the server. Please check your API key and try again.';
    case 'forbidden':
      return 'Must supply an API key! Check your request and try again.';
    case 'rate429':
      return 'Rate limit exceeded.';
    case 'rate529':
      return 'Service temporarily overloaded.';
    default:
      return 'Internal error.';
  }
}

async function readRequestBody(request) {
  try {
    const body = await request.json();
    lastRequest = body;
    return { body };
  } catch {
    return { invalid: 'malformed_json' };
  }
}

/** 按上游实测口径校验请求；不合规则返回对应 `400` / `422`。 */
function validate(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 422, payload: detailField(['body'], 'Field required') };
  }
  for (const field of ['model', 'state', 'questions']) {
    if (body[field] === undefined) {
      return { status: 422, payload: detailField(['body', field], 'Field required') };
    }
  }
  const { questions } = body;
  if (typeof questions !== 'object' || Array.isArray(questions) || Object.keys(questions).length === 0) {
    return { status: 422, payload: detailField(['body', 'questions'], 'Field required') };
  }

  for (const [id, question] of Object.entries(questions)) {
    if (question === null || typeof question !== 'object') {
      return { status: 422, payload: detailField(['body', 'questions', id], 'Field required') };
    }
    if (!QUESTION_TYPES.includes(question.type)) {
      return {
        status: 400,
        payload: detailError('api_usage_error', `Invalid question type: ${String(question.type)}`),
      };
    }
    if (question.type === 'choice') {
      const criteria = question.criteria;
      if (criteria === undefined || criteria === null || typeof criteria !== 'object' || Array.isArray(criteria) || Object.keys(criteria).length === 0) {
        return {
          status: 422,
          payload: detailField(['body', 'questions', id, 'choice', 'criteria'], 'Field required'),
        };
      }
    }
    if (question.type === 'score') {
      if (!Array.isArray(question.criteria) || question.criteria.length === 0) {
        return {
          status: 422,
          payload: detailField(['body', 'questions', id, 'score', 'criteria'], 'Field required'),
        };
      }
    }
    if (question.type === 'noul') {
      const hasInstructions = typeof question.instructions === 'string' && question.instructions.length > 0;
      const hasCriteria = question.criteria !== undefined && question.criteria !== null;
      if (!hasInstructions && !hasCriteria) {
        return {
          status: 400,
          payload: detailError('api_usage_error', `Noul question must have criteria or instructions: ${id}`),
        };
      }
    }
  }
  return null;
}

function compliantResponse(read) {
  if (read.invalid === 'malformed_json') {
    return json(detailError('api_usage_error', 'Invalid request.'), 400);
  }
  const rejection = validate(read.body);
  if (rejection !== null) return json(rejection.payload, rejection.status);

  const { questions } = read.body;
  const answers = {};
  for (const [id, question] of Object.entries(questions)) answers[id] = answerFor(question);

  return json({ model: MOCK_MODEL, answers, usage: { ...NOMINAL_USAGE } });
}

function answerFor(question) {
  switch (question.type) {
    case 'noul':
      // noul 不带 confidence（上游语义：不确定性由概率自身承载）
      return { type: 'noul', noul: NOMINAL_NOUL };
    case 'choice': {
      const options = Object.keys(question.criteria);
      const [chosen, ...rest] = options;
      const probabilities = Object.fromEntries(
        options.map((key) => [key, key === chosen ? 1 : 0]),
      );
      return {
        type: 'choice',
        choice: chosen,
        probabilities,
        confidence: choiceConfidence(options.length, probabilities),
      };
    }
    case 'score':
      return scoreAnswer(question.criteria);
    default:
      // 不可达：validate() 已按白名单拦截
      return { type: question.type };
  }
}

/** 上游公式：均匀分布 = 0，概率全压一项 = 1（`docs/reference/jev-api.md` §6.2）。 */
function choiceConfidence(optionCount, probabilities) {
  if (optionCount <= 1) return 1;
  const top = Math.max(...Object.values(probabilities));
  const even = 1 / optionCount;
  return round4((top - even) / (1 - even));
}

/** `score` 是概率加权级别值，`confidence` 由分布导出——两者必须自洽。 */
function scoreAnswer(levels) {
  const n = levels.length;
  const probabilities = Object.fromEntries(
    levels.map((_, index) => [String(index), index === 0 ? 1 : 0]),
  );
  const score = levels.reduce((sum, _, index) => sum + index * (probabilities[String(index)] ?? 0), 0);
  const peak = 0;
  const spread = levels.reduce((sum, _, index) => sum + (probabilities[String(index)] ?? 0) * Math.abs(index - peak), 0);
  const evenSpread = levels.reduce((sum, _, index) => sum + Math.abs(index - (n - 1) / 2), 0) / n;
  return {
    type: 'score',
    score: round4(score),
    legend: Object.fromEntries(levels.map((level, index) => [String(index), level])),
    probabilities,
    confidence: evenSpread === 0 ? 1 : round4(Math.max(0, 1 - spread / evenSpread)),
  };
}

const round4 = (value) => Math.round(value * 10000) / 10000;

/** 故意不合规：`noul` 缺值 + `choice` 落在枚举外 → 客户端应归 `ERR-05`。 */
function malformedResponse() {
  return json({
    model: MOCK_MODEL,
    answers: {
      risk_score: { type: 'noul' },
      reason_code: { type: 'choice', choice: 'NOT_IN_ENUM' },
    },
    usage: { ...NOMINAL_USAGE },
  });
}
