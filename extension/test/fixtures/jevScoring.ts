import { SCALE_CAP_LINES, WEIGHT_EXPORT, WEIGHT_KEYWORD, WEIGHT_SCALE, WEIGHT_SENSITIVE_PATH } from '../../src/constants';
import type {
  DecisionPolicy,
  DecisionResult,
  HunkPayload,
  IJevClient,
  ReasonCode,
} from '../../src/infra';

/**
 * The `v0.1.0` local mock scorer, kept as a **test fixture**.
 *
 * It stopped being product code in `v0.1.1` — the decision service is now a
 * real HTTP client (`src/infra/jevClient.ts`) — but the weighted scorer is still
 * the reference implementation of the four dimensions and the only offline way
 * to exercise scoring in T1, so it lives with the tests instead of the shipped
 * source. The `IJevClient` shape is identical, which is what made the swap safe
 * (`ADR-002`).
 */

/** Input of the mock scorer (`400-build` §3.3). */
export interface ScoreInput {
  payload: HunkPayload;
  policy: DecisionPolicy;
}

/** Keyword lexicon of the mock scorer, with the attribution each group implies. */
const KEYWORD_RULES: ReadonlyArray<{ keyword: string; code: Exclude<ReasonCode, 'STYLE_ONLY'> }> = [
  { keyword: 'auth', code: 'AUTH_BOUNDARY' },
  { keyword: 'token', code: 'AUTH_BOUNDARY' },
  { keyword: 'password', code: 'AUTH_BOUNDARY' },
  { keyword: 'session', code: 'AUTH_BOUNDARY' },
  { keyword: 'delete', code: 'DATA_WRITE' },
  { keyword: 'transaction', code: 'DATA_WRITE' },
  { keyword: 'catch', code: 'ERROR_HANDLING' },
];

/**
 * Score one hunk with the four weighted dimensions (`300-design` §4.2).
 *
 * Attribution: the highest-weighted *semantic* dimension decides `reasonCode`
 * (change size only contributes to the score). A hunk without any changed line
 * is a pure style case and always returns `STYLE_ONLY` / `PASS`.
 */
export function scoreHunk(input: ScoreInput): DecisionResult {
  const { payload, policy } = input;
  const changedLines = changedLinesOf(payload.diffHunk);

  if (changedLines.length === 0) {
    return { score: 0, decision: 'PASS', reasonCode: 'STYLE_ONLY' };
  }

  const sensitive = matchesSensitivePath(payload.filePath, policy.sensitivePathPatterns) ? 1 : 0;
  const keyword = keywordMatch(changedLines);
  const scale = Math.min(1, changedLines.length / SCALE_CAP_LINES);
  const exported = changedLines.some(isExportDeclaration) ? 1 : 0;

  const score = clamp01(
    sensitive * WEIGHT_SENSITIVE_PATH +
      keyword.ratio * WEIGHT_KEYWORD +
      scale * WEIGHT_SCALE +
      exported * WEIGHT_EXPORT,
  );

  return {
    score,
    decision: score >= policy.riskThreshold ? 'AUDIT' : 'PASS',
    reasonCode: attributeReason(sensitive, exported, keyword),
  };
}

/** In-memory client over {@link scoreHunk}; the T1 injection seam. */
export function createMockJevClient(policy: DecisionPolicy): IJevClient {
  return {
    decide: async (payload: HunkPayload): Promise<DecisionResult> => scoreHunk({ payload, policy }),
  };
}

/** Added/removed lines of the hunk, ignoring the `+++` / `---` file headers. */
function changedLinesOf(diffHunk: string): string[] {
  return diffHunk
    .split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'));
}

function matchesSensitivePath(filePath: string, patterns: string[]): boolean {
  const target = filePath.toLowerCase();
  return patterns.some((pattern) => pattern.length > 0 && target.includes(pattern.toLowerCase()));
}

function keywordMatch(
  changedLines: string[],
): { ratio: number; code: Exclude<ReasonCode, 'STYLE_ONLY'> | null } {
  const haystack = changedLines.join('\n').toLowerCase();
  const hits = KEYWORD_RULES.filter((rule) => haystack.includes(rule.keyword));

  if (hits.length === 0) return { ratio: 0, code: null };
  // Priority follows the lexicon order: auth boundary before data write before error handling.
  return { ratio: Math.min(1, hits.length / KEYWORD_RULES.length), code: hits[0].code };
}

function isExportDeclaration(line: string): boolean {
  return /^[+-]\s*(export|public)\b/.test(line);
}

/**
 * Pick the `reason_code` of the highest-weighted semantic dimension.
 * Change size is intentionally excluded: it says nothing about *what* changed.
 */
function attributeReason(
  sensitive: number,
  exported: number,
  keyword: { ratio: number; code: Exclude<ReasonCode, 'STYLE_ONLY'> | null },
): ReasonCode {
  if (sensitive > 0) return 'AUTH_BOUNDARY';
  if (exported > 0) return 'CONTRACT_BREAK';
  if (keyword.ratio > 0 && keyword.code !== null) return keyword.code;
  return 'STYLE_ONLY';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
