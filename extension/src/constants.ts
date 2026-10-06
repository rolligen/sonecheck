/**
 * Cross-layer named constants — the single place where judgement parameters are
 * allowed to exist as literals (`02` §1「跨层常量」, `INV-07`).
 *
 * Pure data module: it belongs to no layer, imports nothing, and is read-only
 * for UI / Core / Infra. Never add logic or IO here — `GUARD-03` treats any
 * `0.4` / `2048` literal outside this file as a failure.
 */

/**
 * Hard upper bound of one serialized outbound payload, `contextCode` included.
 * Fixed by contract `INV-02` (2 KB); not a tuning knob.
 */
export const MAX_PAYLOAD_BYTES = 2048;

/**
 * Exact byte size of the `v0.1.0` wire frame with all four values empty:
 * `{"file_path":"","change_type":"","diff_hunk":"","context_code":""}`.
 * `local_metadata` is not part of this version, so the frame is stable.
 */
export const PAYLOAD_JSON_FRAME_BYTES = 66;

/**
 * Bytes reserved for the hunk metadata while chunking: the JSON frame, the file
 * path, the change type and a minimal context. A hunk whose `diff_hunk` alone
 * exceeds `MAX_PAYLOAD_BYTES` minus this reserve is split (`300-design` §4.3).
 */
export const HUNK_METADATA_RESERVE_BYTES = 512;

/**
 * Fallback context window: lines kept before/after the hunk when scope
 * detection fails (`300-design` §4.1). S3 backfills the final value from S2
 * Harness data.
 */
export const CONTEXT_WINDOW_LINES = 10;

/**
 * Default risk threshold, mirroring `CFG-01` (`sonecheck.riskThreshold`).
 *
 * S3 backfill (`300-design` §4.2 / `dev-meta/docs/02-version-rules.md` §6.3):
 * the S2 Harness saw a size-only noise floor at `0.20` and semantic hits from
 * `0.40` upward (sensitive path alone = `0.40`), so the threshold sits at
 * **2.0×** the noise floor — inside the required 1.5–2.5× margin. At this value
 * 1.4 % of the 436 measured hunks audit, and any sensitive-path change always
 * does (the acceptance scenario of `200-spec` §2).
 */
export const RISK_THRESHOLD = 0.4;

/** Default pick-list cap (Top-K), mirroring `CFG-01` (`sonecheck.maxItems`). */
export const MAX_ITEMS = 3;

/** Upper bound for `git diff --staged` stdout (bytes) passed to `execSync`. */
export const GIT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Per-request timeout of the decision call, in milliseconds.
 *
 * Settled from a live-endpoint measurement (2026-10-06): the first request of a
 * session costs 429 ms (cold TLS + service warm-up), steady state is 152-213 ms.
 * The original 400 ms budget therefore produced a false `ERR-02` on cold start;
 * 500 ms is the ceiling of the per-hunk decision budget (`00` §3), so it is the
 * largest value that keeps the numeric hierarchy intact. Timeouts are **not**
 * retried — only `429` / `529` are (`03` §2.1).
 */
export const REQUEST_TIMEOUT_MS = 500;

/** Retry attempts for `429` / `529` only, on top of the first attempt. */
export const RETRY_MAX_ATTEMPTS = 1;

/** Backoff before the single retry. Keeps the 429 path under the p95 budget. */
export const RETRY_BACKOFF_MS = 150;

/** Maximum in-flight decision requests per inspection (`02` §4). */
export const MAX_CONCURRENCY = 4;

/**
 * Default decision endpoint. Overridable per workspace via
 * `sonecheck.endpoint` (`CFG-01`) for the contract mock, a proxy or a
 * self-hosted gateway — never for a different vendor's API shape.
 */
export const JEV_ENDPOINT_DEFAULT = 'https://api.typesafe.ai/v1/systemone';

/**
 * Changed-line count at which the "change size" dimension saturates (`300-design` §4.2).
 * S3 backfills the final value from S2 Harness data.
 */
export const SCALE_CAP_LINES = 30;

/** Mock scoring weights (`300-design` §4.2). Kept here so S3 can retune them in one place. */
export const WEIGHT_SENSITIVE_PATH = 0.4;
/** See {@link WEIGHT_SENSITIVE_PATH}. */
export const WEIGHT_KEYWORD = 0.2;
/** See {@link WEIGHT_SENSITIVE_PATH}. */
export const WEIGHT_SCALE = 0.2;
/** See {@link WEIGHT_SENSITIVE_PATH}. */
export const WEIGHT_EXPORT = 0.2;

/**
 * Build-time logging switch. `v0.1.0` has no runtime logging at all; the flag
 * exists so that `tsc` folds the detailed-field branch away in release builds
 * (`06` §2 / §4) and users cannot enable it via settings.
 */
export const DEBUG_LOGGING = false;
