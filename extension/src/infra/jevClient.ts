import {
  JEV_MODEL_ID,
  RETRY_BACKOFF_MS,
  RETRY_MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
} from '../constants';

/**
 * Jev decision client — the only outbound boundary of the extension
 * (`API-01`, `02` §2 `infra/jevClient`).
 *
 * `v0.1.1` implementation: a real HTTP client (hand-written `fetch`, no SDK —
 * `ADR-004`). The public surface frozen in `v0.1.0` is unchanged: `decide()`
 * keeps its signature and `DecisionResult` only gained the optional `failure`
 * field, so the mock and the real client are interchangeable by construction
 * (`ADR-002`).
 *
 * Two invariants shape everything here:
 *
 * 1. **Never rejects.** A failure resolves as a `DecisionResult` carrying
 *    `failure`, never an exception. Callers degrade per hunk (`INV-04`), and a
 *    partial batch must not be discarded because one block failed.
 * 2. **Never leaks the key.** The key is read through an injected getter and
 *    used only for the `Authorization` header; it never enters the payload, a
 *    log line or a return value (`INV-03`).
 */

/** Change kind of a hunk; serializes to `change_type` (`03` §2.1 Request). */
export type ChangeType = 'MODIFY' | 'ADD' | 'DELETE';

/**
 * Outbound payload for a single hunk (`API-01` Request).
 *
 * Precondition: the serialized payload total length must not exceed
 * `MAX_PAYLOAD_BYTES`; the caller (`core/contextBuilder`) guarantees it.
 */
export interface HunkPayload {
  /** Repository-relative path (`file_path` on the wire). */
  filePath: string;
  /** Change kind (`change_type` on the wire). */
  changeType: ChangeType;
  /** Added/removed lines of this hunk (`diff_hunk` on the wire). */
  diffHunk: string;
  /** Bounded scope context (`context_code` on the wire). */
  contextCode: string;
}

/**
 * `reason_code` values delivered by this version (`03` §2.4).
 *
 * One value per hunk; the enum is a closed set — a value outside it is treated
 * as a schema violation (dropped, `ERR-05`).
 */
export type ReasonCode =
  | 'AUTH_BOUNDARY'
  | 'DATA_WRITE'
  | 'CONTRACT_BREAK'
  | 'ERROR_HANDLING'
  | 'STYLE_ONLY';

/**
 * Failure classes this client can report (`03` §2.1 failure face).
 *
 * `ERR-08` is a guard: the wide branch in `ui/commands` should short-circuit
 * before a decision call, so seeing it here means the seam leaked.
 */
export type JevFailureCode = 'ERR-01' | 'ERR-02' | 'ERR-03' | 'ERR-04' | 'ERR-05' | 'ERR-08';

/**
 * Decision result consumed by `core/riskEngine`.
 *
 * `score` is a continuous probability in `[0, 1]`; `decision` is derived
 * locally from `score` and the configured threshold — it is never returned by
 * the upstream service. `failure` is present only when the call did not produce
 * a usable judgement: the block is then passed through (never listed) and the
 * code is aggregated for a one-shot prompt (`INV-04`).
 */
export interface DecisionResult {
  score: number;
  decision: 'AUDIT' | 'PASS';
  reasonCode: ReasonCode;
  failure?: JevFailureCode;
}

/**
 * Frozen decision-service abstraction.
 *
 * Invariants (shared by the `v0.1.0` mock and the `v0.1.1` real client):
 * - same input yields the same output (idempotent);
 * - a failure never throws business errors upward — the caller degrades;
 * - the signature and `DecisionResult` fields do not change between versions.
 */
export interface IJevClient {
  decide(payload: HunkPayload): Promise<DecisionResult>;
}

/**
 * The part of the normalized configuration the decision call needs.
 *
 * Declared here (not imported from `core`) to keep the layer direction intact:
 * infra must not depend on upper layers. `SoneCheckConfig` satisfies it
 * structurally.
 */
export interface DecisionPolicy {
  /**
   * `CFG-01` `sensitivePathPatterns`. Unused by the real client — the upstream
   * judges the payload as given — but kept so the injected factory keeps one
   * shape across mock and real implementations.
   */
  sensitivePathPatterns: string[];
  /** `CFG-01` `riskThreshold`: boundary between `AUDIT` and `PASS`. */
  riskThreshold: number;
}

/** Rubric sent as `reason_code`'s `criteria` — one entry per enum value (`03` §2.4). */
export const REASON_CODE_RUBRIC: Readonly<Record<ReasonCode, string>> = {
  AUTH_BOUNDARY: 'Changes to authentication, authorization, sessions or credential handling.',
  DATA_WRITE: 'Changes that write data: inserts, updates, deletes, transactions, money amounts.',
  CONTRACT_BREAK: 'Breaking changes to exported signatures, API fields or schemas.',
  ERROR_HANDLING: 'Changes to exception handling, retry or backoff logic, or swallowed errors.',
  STYLE_ONLY: 'Pure style, comments or formatting only.',
};

/** Request body as `API-01` expects it (`03` §2.1 Request). */
export interface JevRequest {
  model: string;
  state: {
    file_path: string;
    change_type: ChangeType;
    diff_hunk: string;
    context_code: string;
  };
  questions: {
    risk_score: {
      type: 'noul';
      instructions: Record<string, string>;
      criteria: { true: string; false: string };
    };
    reason_code: {
      type: 'choice';
      instructions: Record<string, string>;
      criteria: Record<ReasonCode, string>;
    };
  };
}

/**
 * Assemble the request for one hunk.
 *
 * Both questions ride in a single call and cannot see each other's answers —
 * measured at +16 ms over a single question, so splitting them would cost a
 * round trip for nothing. `instructions` are structured objects that name the
 * `state` fields in backticks: the upstream's judged score drops sharply when
 * the payload is padded with noise, so pointing at the fields explicitly is a
 * quality lever, not cosmetics.
 */
export function buildJevRequest(payload: HunkPayload, model: string = JEV_MODEL_ID): JevRequest {
  return {
    model,
    state: {
      file_path: payload.filePath,
      change_type: payload.changeType,
      diff_hunk: payload.diffHunk,
      context_code: payload.contextCode,
    },
    questions: {
      risk_score: {
        type: 'noul',
        instructions: {
          change: 'One hunk of a staged diff is under review.',
          fields:
            '`file_path` is the changed file, `diff_hunk` holds the added and removed lines, `context_code` is the surrounding scope.',
          question:
            'Does `diff_hunk` touch authentication, authorization, credentials or data writes in a way a reviewer must look at?',
        },
        criteria: {
          true: 'Yes — the change touches auth, credentials or data writes.',
          false: 'No — the change is unrelated to auth, credentials or data writes.',
        },
      },
      reason_code: {
        type: 'choice',
        instructions: {
          change: 'The same staged hunk is under review.',
          question: 'Which single category best describes the main risk of `diff_hunk` inside `context_code`?',
        },
        criteria: { ...REASON_CODE_RUBRIC },
      },
    },
  };
}

/** Dependencies of the real client; `fetchImpl` exists for T1 injection. */
export interface JevClientDeps {
  /** Absolute evaluation endpoint (`CFG-01` `sonecheck.endpoint`). */
  endpoint: string;
  /** Reads the key from SecretStorage; `null` when not configured. */
  getApiKey: () => Promise<string | null>;
  /**
   * Threshold policy of the inspection this client serves. Passed at
   * construction because `decide()`'s signature is frozen (`ADR-002`), and
   * `decision` is derived locally rather than returned upstream.
   */
  policy: DecisionPolicy;
  /** Injected in unit tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

interface AttemptOutcome {
  result?: DecisionResult;
  failure: JevFailureCode;
  /** Only `429` / `529` are worth another attempt (`03` §2.1 retry policy). */
  retryable: boolean;
}

/**
 * Create the `v0.1.1` client: real HTTP, one retry for capacity errors, and a
 * normalized failure on every other path. The assembly layer injects it; tests
 * inject a stub (`01` §3 T1 mock discipline).
 */
export function createJevClient(deps: JevClientDeps): IJevClient {
  const doFetch = deps.fetchImpl ?? fetch;

  return {
    async decide(payload: HunkPayload): Promise<DecisionResult> {
      const apiKey = await deps.getApiKey();
      if (apiKey === null || apiKey.trim() === '') return passThrough('ERR-08');

      const body = JSON.stringify(buildJevRequest(payload));
      let attempt = 0;

      for (;;) {
        const outcome = await attemptOnce(doFetch, deps.endpoint, apiKey, body, deps.policy);
        if (outcome.result !== undefined) return outcome.result;
        if (!outcome.retryable || attempt >= RETRY_MAX_ATTEMPTS) return passThrough(outcome.failure);
        attempt += 1;
        await sleep(RETRY_BACKOFF_MS);
      }
    },
  };
}

async function attemptOnce(
  doFetch: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: string,
  policy: DecisionPolicy,
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        failure: classifyHttpFailure(response.status),
        retryable: response.status === 429 || response.status === 529,
      };
    }

    const result = parseDecision(await response.json(), policy);
    return result === undefined
      ? { failure: 'ERR-05', retryable: false }
      : { result, failure: 'ERR-05', retryable: false };
  } catch (error) {
    return { failure: isTimeout(error) ? 'ERR-02' : 'ERR-01', retryable: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map an upstream status to a failure class (`03` §2.1).
 *
 * `400` / `422` mean *our* request is wrong, not the service being unwell, so
 * they join `ERR-05` (drop the block, never retry) instead of the generic
 * `ERR-03`. `401` / `403` are authentication, not capacity, so they must not
 * be retried either — only `429` / `529` are.
 */
export function classifyHttpFailure(status: number): JevFailureCode {
  if (status === 400 || status === 422) return 'ERR-05';
  if (status === 401 || status === 403 || status === 429 || status === 529) return 'ERR-04';
  return 'ERR-03';
}

/**
 * Turn a 2xx body into a decision, or into `ERR-05` when it does not hold up.
 *
 * The error body is never parsed: the upstream's `detail` shape is not stable
 * (`03` §2.1), and normalization is by status code only.
 */
function parseDecision(body: unknown, policy: DecisionPolicy): DecisionResult | undefined {
  if (body === null || typeof body !== 'object') return undefined;

  const answers = (body as { answers?: unknown }).answers;
  if (answers === null || typeof answers !== 'object') return undefined;

  const risk = (answers as Record<string, unknown>).risk_score as { noul?: unknown } | undefined;
  const reason = (answers as Record<string, unknown>).reason_code as { choice?: unknown } | undefined;
  if (risk === undefined || reason === undefined) return undefined;

  const score = risk.noul;
  const choice = reason.choice;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return undefined;
  if (typeof choice !== 'string' || !(choice in REASON_CODE_RUBRIC)) return undefined;

  return {
    score,
    decision: score >= policy.riskThreshold ? 'AUDIT' : 'PASS',
    reasonCode: choice as ReasonCode,
  };
}

function passThrough(failure: JevFailureCode): DecisionResult {
  return { score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY', failure };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serialize a payload exactly as `API-01` Request expects it (snake_case keys).
 *
 * Owned here because this module owns the wire format: the same mapping is used
 * by the `v0.1.1` HTTP client, and it is the single source for measuring the
 * `INV-02` bound.
 */
export function serializePayload(payload: HunkPayload): string {
  return JSON.stringify({
    file_path: payload.filePath,
    change_type: payload.changeType,
    diff_hunk: payload.diffHunk,
    context_code: payload.contextCode,
  });
}

/** Wire length of a JSON string value: its escaped bytes, quotes excluded. */
export function wireBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') - 2;
}

/**
 * Wire cost of one line break inside a JSON string: the raw newline byte plus
 * the backslash of its escape. Multi-line fields are measured additively with
 * this constant (`wire(a + "\n" + b) === wire(a) + WIRE_LINE_SEPARATOR_BYTES + wire(b)`).
 */
export const WIRE_LINE_SEPARATOR_BYTES = 2;

/**
 * Truncate `value` to `budget` wire bytes without splitting a code point.
 * Binary search keeps the result exact even when escaping inflates it.
 */
export function truncateToWireBytes(value: string, budget: number): string {
  if (budget <= 0) return '';

  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  let best = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (wireBytes(chars.slice(0, middle).join('')) <= budget) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return chars.slice(0, best).join('');
}
