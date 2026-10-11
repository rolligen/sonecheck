/**
 * Infra Facade — the only entry the Core layer (and the UI's config read) may
 * import (`02` §1).
 *
 * `core` depends on `IJevClient` only: the concrete implementation is injected by
 * the assembly layer, so the decision service can be swapped without touching
 * callers (`ADR-002`). `src/infra/**` internals stay private.
 */

export { buildJevRequest, classifyHttpFailure, createJevClient, REASON_CODE_RUBRIC, serializePayload } from './jevClient';
export { parseDiff } from './diffParser';
export { truncateToWireBytes, wireBytes } from './jevClient';
export { LocalFailure, readStagedDiff, resolveRepoRoot } from './git';
export { readSourceLines } from './sourceReader';
export { readRawConfig } from './configSource';
export { createSecrets } from './secrets';

export type {
  ChangeType,
  DecisionPolicy,
  DecisionResult,
  HunkPayload,
  IJevClient,
  JevClientDeps,
  JevFailureCode,
  JevRequest,
  ReasonCode,
} from './jevClient';
export type { SecretStoragePort, Secrets } from './secrets';
export type { Hunk } from './diffParser';
export type { LocalFailureCode } from './git';
export type { RawConfig } from './configSource';
