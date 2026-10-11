import {
  HTTP_PROTOCOL,
  HTTPS_PROTOCOL,
  JEV_ENDPOINT_DEFAULT,
  LOOPBACK_HOSTS,
  MAX_ITEMS,
  RISK_THRESHOLD,
} from '../constants';

/** Normalized configuration consumed by the core pipeline (`CFG-01`). */
export interface SoneCheckConfig {
  riskThreshold: number;
  maxItems: number;
  enabled: boolean;
  sensitivePathPatterns: string[];
  /** Decision endpoint, already normalized (`CFG-01`). */
  endpoint: string;
}

/** Shape accepted from the infra layer, before validation. */
export interface RawConfigInput {
  riskThreshold?: number;
  maxItems?: number;
  enabled?: boolean;
  sensitivePathPatterns?: string[];
  endpoint?: string;
}

/** `CFG-01` default sensitive paths. */
const DEFAULT_SENSITIVE_PATH_PATTERNS: readonly string[] = ['auth', 'payment', 'migration'];

const MIN_RISK_THRESHOLD = 0;
const MAX_RISK_THRESHOLD = 1;
const MIN_ITEMS = 1;
const MAX_ITEMS_LIMIT = 20;

/**
 * Validate and complete raw settings (`CFG-01`).
 *
 * Pure function, no VS Code API: out-of-range values fall back to the named
 * constants, missing fields are filled with defaults, and every value stays
 * inside the contract's documented bounds.
 */
export function normalizeConfig(raw: RawConfigInput): SoneCheckConfig {
  return {
    riskThreshold: normalizeRiskThreshold(raw.riskThreshold),
    maxItems: normalizeMaxItems(raw.maxItems),
    enabled: raw.enabled ?? true,
    sensitivePathPatterns: normalizePatterns(raw.sensitivePathPatterns),
    endpoint: normalizeEndpoint(raw.endpoint),
  };
}

/**
 * Normalize the decision endpoint (`CFG-01`, `ADR-007`).
 *
 * https anywhere is accepted; plaintext http only on loopback, which is where
 * the contract mock and a self-hosted gateway run. Everything else — empty,
 * unparseable, or plaintext to a remote host — falls back to the official
 * endpoint, so a mistyped setting can never ship diff payloads in clear text.
 */
function normalizeEndpoint(value: string | undefined): string {
  if (typeof value !== 'string') return JEV_ENDPOINT_DEFAULT;

  const trimmed = value.trim();
  if (trimmed === '') return JEV_ENDPOINT_DEFAULT;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return JEV_ENDPOINT_DEFAULT;
  }

  if (url.protocol === HTTPS_PROTOCOL) return trimmed;
  if (url.protocol === HTTP_PROTOCOL && LOOPBACK_HOSTS.includes(url.hostname)) return trimmed;

  return JEV_ENDPOINT_DEFAULT;
}

function normalizeRiskThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return RISK_THRESHOLD;
  // `CFG-01`: 0.0 < v < 1.0 — both ends are exclusive.
  if (value <= MIN_RISK_THRESHOLD || value >= MAX_RISK_THRESHOLD) return RISK_THRESHOLD;
  return value;
}

function normalizeMaxItems(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return MAX_ITEMS;
  if (value < MIN_ITEMS || value > MAX_ITEMS_LIMIT) return MAX_ITEMS;
  return value;
}

function normalizePatterns(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_SENSITIVE_PATH_PATTERNS];

  const patterns = value
    .filter((pattern): pattern is string => typeof pattern === 'string')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);

  return patterns.length > 0 ? patterns : [...DEFAULT_SENSITIVE_PATH_PATTERNS];
}
