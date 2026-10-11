import * as vscode from 'vscode';

/**
 * Raw (not yet validated) values of the `sonecheck.*` settings.
 *
 * Every field is optional: absent or invalid values are filled in by
 * `core/config.normalizeConfig` (`CFG-01`).
 */
export interface RawConfig {
  riskThreshold?: number;
  maxItems?: number;
  enabled?: boolean;
  sensitivePathPatterns?: string[];
  /** Decision endpoint override (`CFG-01`); normalized in `core/config`. */
  endpoint?: string;
}

/**
 * The **only** place in the extension that reads VS Code configuration
 * (`GUARD-02`). Everything else receives normalized values from `core`.
 *
 * Keys live in SecretStorage and are read through `infra/secrets` — never
 * from here (`02` §2「密钥边界」).
 */
export function readRawConfig(): RawConfig {
  const section = vscode.workspace.getConfiguration('sonecheck');
  return {
    riskThreshold: section.get<number>('riskThreshold'),
    maxItems: section.get<number>('maxItems'),
    enabled: section.get<boolean>('enabled'),
    sensitivePathPatterns: section.get<string[]>('sensitivePathPatterns'),
    endpoint: section.get<string>('endpoint'),
  };
}
