import { MAX_CONCURRENCY } from '../constants';
import { LocalFailure, parseDiff } from '../infra';
import type {
  DecisionPolicy,
  DecisionResult,
  Hunk,
  HunkPayload,
  IJevClient,
  JevFailureCode,
} from '../infra';

import { buildContext } from './contextBuilder';
import type { SoneCheckConfig } from './config';
import { filterRisky } from './threshold';
import type { RiskItem, ScoredHunk } from './threshold';

/**
 * One inspection's outcome: the list plus **why it looks the way it does**.
 *
 * `v0.1.0` returned a bare `RiskItem[]`, which cannot answer the only question a
 * user actually has when nothing shows up — "was there nothing risky, or did the
 * service fail, or is the key missing?". So the exit type became a report and
 * attribution moved into `core`: `ui` only presents (`02` §2).
 */
export interface InspectionReport {
  /** Listed items, already filtered / ranked / truncated to `maxItems`. */
  items: RiskItem[];
  /** Degraded blocks grouped by failure code, most frequent first. */
  degraded: { code: JevFailureCode; count: number }[];
  /** `'NO_KEY'` when the inspection was skipped because no key is configured. */
  skipped: 'NO_KEY' | null;
}

/**
 * IO capabilities the engine needs, injected by the assembly layer
 * (`02` §2「判定服务抽象」 + `400-build` §3.5 step 6). Pure functions
 * (`parseDiff` / `buildContext` / `filterRisky`) are imported directly — they
 * need no substitution.
 */
export interface RiskEngineDeps {
  resolveRepoRoot(cwd: string): string;
  readStagedDiff(cwd: string): string;
  readSourceLines(repoRoot: string, filePath: string): string[];
  /** Builds the decision client for one inspection. */
  createClient(policy: DecisionPolicy): IJevClient;
  /** Key readability probe — the wide branch short-circuits on `false`. */
  hasApiKey(): Promise<boolean>;
}

/** The version's main pipeline (`300-design` §3). */
export interface RiskEngine {
  /**
   * Run one full inspection.
   *
   * Always resolves to an {@link InspectionReport} and never throws an
   * unclassified error: local failures (`ERR-06` / `ERR-07` / `ERR-09`) are
   * raised as {@link LocalFailure} so the UI can prompt once and pass through
   * (`INV-01`).
   *
   * Invariant: when the inspection actually ran, an empty `items` is always
   * explainable — `degraded` (everything failed) or `skipped` (no key) is
   * non-empty. The single exception is `enabled: false`, where the user turned
   * the feature off and an empty report is the correct answer.
   */
  inspect(config: SoneCheckConfig, cwd: string): Promise<InspectionReport>;
}

export function createRiskEngine(deps: RiskEngineDeps): RiskEngine {
  return {
    inspect: async (config: SoneCheckConfig, cwd: string): Promise<InspectionReport> => {
      if (!config.enabled) return { items: [], degraded: [], skipped: null };

      // Wide branch before local failure: ask "can we judge at all" before
      // "is there anything to judge" — otherwise a key prompt would mask the
      // real reason on an empty stage (ADR-006).
      if (!(await deps.hasApiKey())) return { items: [], degraded: [], skipped: 'NO_KEY' };

      const repoRoot = deps.resolveRepoRoot(cwd);
      const hunks = parseDiff(deps.readStagedDiff(repoRoot));

      if (hunks.length === 0) {
        throw new LocalFailure('ERR-07', 'no staged changes');
      }

      const policy: DecisionPolicy = {
        sensitivePathPatterns: config.sensitivePathPatterns,
        riskThreshold: config.riskThreshold,
      };
      const client = deps.createClient(policy);
      const sourceCache = new Map<string, string[]>();
      const readLines = (filePath: string): string[] => {
        const cached = sourceCache.get(filePath);
        if (cached !== undefined) return cached;
        const lines = deps.readSourceLines(repoRoot, filePath);
        sourceCache.set(filePath, lines);
        return lines;
      };

      const results = await decideAll(
        client,
        hunks.map((hunk) => toPayload(hunk, readLines)),
      );

      // Failed blocks leave the pipeline before thresholding: they must not
      // consume a Top-K slot nor appear with a `PASS` score they never got.
      const scored: ScoredHunk[] = [];
      for (const [index, result] of results.entries()) {
        if (result.failure === undefined) scored.push({ hunk: hunks[index], result });
      }

      return {
        items: filterRisky(
          scored,
          config,
          (hunk: Hunk) => isLocatable(hunk, readLines(hunk.filePath)),
        ),
        degraded: tallyFailures(results),
        skipped: null,
      };
    },
  };
}

/**
 * Fan the hunk payloads out over at most `MAX_CONCURRENCY` workers sharing one
 * cursor, writing results back by index.
 *
 * The index write-back is what keeps the report reproducible: list order stays
 * the diff order regardless of which request finished first, so Top-K does not
 * depend on network timing. Sequential `await` was fine for the `v0.1.0` mock
 * but cannot hold the end-to-end budget against a real endpoint.
 */
async function decideAll(
  client: IJevClient,
  payloads: HunkPayload[],
): Promise<DecisionResult[]> {
  const results = new Array<DecisionResult>(payloads.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= payloads.length) return;
      results[index] = await client.decide(payloads[index]);
    }
  };

  const width = Math.min(MAX_CONCURRENCY, payloads.length);
  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

/** Group failed blocks by code, most frequent first, ties broken by code. */
function tallyFailures(results: DecisionResult[]): { code: JevFailureCode; count: number }[] {
  const counts = new Map<JevFailureCode, number>();
  for (const result of results) {
    if (result.failure !== undefined) counts.set(result.failure, (counts.get(result.failure) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function toPayload(hunk: Hunk, readLines: (filePath: string) => string[]): HunkPayload {
  return {
    filePath: hunk.filePath,
    changeType: hunk.changeType,
    diffHunk: hunk.diffContent,
    contextCode: buildContext(hunk, readLines(hunk.filePath)),
  };
}

/** `INV-06`: the file exists and the hunk's first line is inside it. */
function isLocatable(hunk: Hunk, lines: string[]): boolean {
  return lines.length > 0 && hunk.startLine >= 1 && hunk.startLine <= lines.length;
}
