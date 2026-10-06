import type * as vscode from 'vscode';

import { createRiskEngine } from './core';
import { createJevClient, createSecrets, readRawConfig, readSourceLines, readStagedDiff, resolveRepoRoot } from './infra';
import type { Secrets } from './infra';
import { normalizeConfig } from './core';
import { registerCommands } from './ui/commands';

/**
 * SoneCheck — extension entry point (assembly layer, `02` §2 `src/extension.ts`).
 *
 * The only job of this file is wiring: it binds the infra capabilities to the
 * core engine and registers the UI commands. The decision client is injected
 * here, which is why `v0.1.1` could replace the mock without touching a caller
 * (`ADR-002`).
 */
export function activate(context: vscode.ExtensionContext): void {
  // SecretStorage arrives as a port, so this module is the only place that
  // knows the host API exists (`02` §2「密钥边界」).
  const secrets: Secrets = createSecrets(context.secrets);

  const engine = createRiskEngine({
    resolveRepoRoot,
    readStagedDiff,
    readSourceLines,
    hasApiKey: () => secrets.hasApiKey(),
    createClient: (policy) => {
      // The endpoint is normalized per inspection: it is a workspace setting and
      // may change without a reload (`CFG-01`).
      const { endpoint } = normalizeConfig(readRawConfig());
      return createJevClient({ endpoint, getApiKey: () => secrets.getApiKey(), policy });
    },
  });

  context.subscriptions.push(...registerCommands(engine, secrets));
}

export function deactivate(): void {
  // Nothing to dispose: every subscription is owned by the activation context.
}
