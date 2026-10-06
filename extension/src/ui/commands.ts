import * as vscode from 'vscode';

import { LocalFailure, readRawConfig } from '../infra';
import type { Secrets } from '../infra';
import { normalizeConfig } from '../core';
import type { InspectionReport, RiskEngine } from '../core';
import { revealRiskItem, showRiskList } from './riskList';
import { createStatusReporter } from './status';
import type { StatusReporter } from './status';

/** Command id, identical to `API-02` in the contract (`03` §2.2). */
const INSPECT_COMMAND = 'sonecheck.inspectDiff';

/** Command id of `API-03` (`03` §2.3). */
export const SET_API_KEY_COMMAND = 'sonecheck.setApiKey';

/**
 * Register the command surface.
 *
 * The UI layer only orchestrates: read raw settings → normalize → run the engine
 * → hand the result to the presentation layer. Every failure is caught here,
 * prompted **once** and swallowed, so a check can never block the user's commit
 * (`INV-01`).
 */
export function registerCommands(engine: RiskEngine, secrets: Secrets): vscode.Disposable[] {
  const status = createStatusReporter();

  return [
    vscode.commands.registerCommand(INSPECT_COMMAND, () => runInspection(engine, status)),
    vscode.commands.registerCommand(SET_API_KEY_COMMAND, () =>
      runSetApiKey({
        hasApiKey: () => secrets.hasApiKey(),
        setApiKey: (value: string) => secrets.setApiKey(value),
        clearApiKey: () => secrets.clearApiKey(),
        promptInput: () =>
          vscode.window.showInputBox({
            password: true,
            prompt: 'Jev API Key',
            placeHolder: '在 https://console.typesafe.ai/keys 创建；留空可清除',
            ignoreFocusOut: true,
          }),
        confirm: (message: string) =>
          vscode.window
            .showWarningMessage(message, { modal: true }, '清除')
            .then((choice) => choice === '清除'),
        notify: (message: string) => status.notify(message),
      }),
    ),
    status,
  ];
}

/**
 * `API-03` as a pure, injectable flow.
 *
 * The branches live here rather than inside the command callback so that
 * `ERR-10` (cancel) and `ERR-11` (empty string) are unit-testable — a native
 * input box cannot be driven from plain Node. The key value never reaches
 * `notify`: no branch echoes the plaintext (`INV-03`).
 */
export interface SetApiKeyDeps {
  hasApiKey(): PromiseLike<boolean>;
  setApiKey(value: string): PromiseLike<void>;
  clearApiKey(): PromiseLike<void>;
  /** Resolves `undefined` when the user dismisses the input box. */
  promptInput(): PromiseLike<string | undefined>;
  confirm(message: string): PromiseLike<boolean>;
  notify(message: string): PromiseLike<void>;
}

export async function runSetApiKey(deps: SetApiKeyDeps): Promise<void> {
  const value = await deps.promptInput();

  // ERR-10: dismissed — no write, no prompt, no residue.
  if (value === undefined) return;

  if (value.trim() === '') {
    if (!(await deps.hasApiKey())) {
      await deps.notify('SoneCheck: 未配置 API Key，无需清除');
      return;
    }
    // ERR-11: clearing needs an explicit confirmation; declining keeps the key.
    if (!(await deps.confirm('输入为空：确定清除已保存的 Jev API Key 吗？'))) {
      await deps.notify('SoneCheck: 已保留原有 API Key');
      return;
    }
    await deps.clearApiKey();
    await deps.notify('SoneCheck: 已清除 Jev API Key');
    return;
  }

  await deps.setApiKey(value);
  await deps.notify('SoneCheck: 已保存 Jev API Key');
}

async function runInspection(engine: RiskEngine, status: StatusReporter): Promise<void> {
  const config = normalizeConfig(readRawConfig());

  if (!config.enabled) {
    await status.notify('SoneCheck: 已在设置中关闭（sonecheck.enabled）');
    return;
  }

  status.set('running');

  try {
    const report = await engine.inspect(config, workspaceRoot());

    if (report.skipped === 'NO_KEY') {
      // Wide branch (ADR-006): not a failure, nothing blocked. S5 replaces this
      // with the one-time guide notification plus the `未配置 Key` status state.
      status.set('warning');
      await status.notify('SoneCheck: 未配置 Jev API Key（检查已跳过）', 'warn');
      return;
    }

    if (report.items.length === 0) {
      if (report.degraded.length > 0) {
        // Degraded blocks were dropped: say so instead of showing an empty list.
        // S5 owns the final wording and the per-session de-duplication.
        status.set('warning');
        await status.notify(describeDegraded(report), 'warn');
        return;
      }
      // Zero disturbance: a single transient status line, never a popup (US-03).
      status.set('clear');
      return;
    }

    status.set('idle');
    const picked = await showRiskList(report.items);

    if (picked !== undefined && !(await revealRiskItem(picked, workspaceRoot()))) {
      status.set('warning');
      await status.notify('SoneCheck: 该条目已无法定位（文件或行号已失效）', 'warn');
    }
  } catch (error) {
    await reportFailure(error, status);
  }
}

/** Minimal degraded summary; the count is what matters most, so it leads. */
function describeDegraded(report: InspectionReport): string {
  const failed = report.degraded.reduce((sum, entry) => sum + entry.count, 0);
  return `SoneCheck: 已跳过 ${failed} 块改动（判定服务不可用），可稍后重试`;
}

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

/** One-shot prompt per failure; never re-thrown, never silent (`400-build` §3.5). */
async function reportFailure(error: unknown, status: StatusReporter): Promise<void> {
  if (error instanceof LocalFailure) {
    switch (error.code) {
      case 'ERR-07':
        status.set('empty');
        await status.notify('SoneCheck: 无暂存改动');
        return;
      case 'ERR-06':
        status.set('warning');
        await status.notify('SoneCheck: 当前工作区不是 git 仓库', 'warn');
        return;
      default:
        status.set('warning');
        await status.notify('SoneCheck: 未找到 git 可执行文件', 'warn');
        return;
    }
  }

  status.set('warning');
  await status.notify('SoneCheck: 检查已跳过（内部错误）', 'warn');
}
