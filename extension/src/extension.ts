import type * as vscode from 'vscode';

import { JEV_ENDPOINT_DEFAULT } from './constants';
import { createRiskEngine } from './core';
import { createJevClient, readSourceLines, readStagedDiff, resolveRepoRoot } from './infra';
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
  const engine = createRiskEngine({
    resolveRepoRoot,
    readStagedDiff,
    readSourceLines,
    // S4 replaces the two placeholders below: the endpoint comes from
    // `sonecheck.endpoint` (normalized in `core/config`) and the key from
    // `infra/secrets` (`API-03`). Until then every decision resolves to the
    // `ERR-08` pass-through, i.e. the list stays empty rather than wrong.
    createClient: (policy) =>
      createJevClient({
        endpoint: JEV_ENDPOINT_DEFAULT,
        getApiKey: async () => null,
        policy,
      }),
  });

  context.subscriptions.push(...registerCommands(engine));
}

export function deactivate(): void {
  // Nothing to dispose: every subscription is owned by the activation context.
}
