import * as vscode from 'vscode';

import { LocalFailure, readRawConfig } from '../infra';
import type { Secrets } from '../infra';
import type { JevFailureCode } from '../infra';
import { normalizeConfig } from '../core';
import type { InspectionReport, RiskEngine } from '../core';
import { revealRiskItem, showRiskList } from './riskList';
import { createStatusReporter } from './status';
import type { StatusReporter } from './status';

/** Command id, identical to `API-02` in the contract (`03` §2.2). */
const INSPECT_COMMAND = 'sonecheck.inspectDiff';

/** Command id of `API-03` (`03` §2.3). */
export const SET_API_KEY_COMMAND = 'sonecheck.setApiKey';

/** Action label of the one-time guide button (`04` §2). */
const SET_KEY_ACTION = '设置 Key';

/** One-time guide message; states the consequence, not the mechanics. */
const GUIDE_MESSAGE = 'SoneCheck 需要 Jev API Key 才能判定改动风险';

/**
 * Failure classes rendered for humans; the codes stay in the report, the labels
 * live here (`04` §2 is the copy SSOT). Unknown codes fall back to the code
 * itself rather than swallowing it.
 *
 * `ERR-08` is absent on purpose: a missing key never reaches a decision, it
 * short-circuits into `skipped` (`ADR-006`), so it can never appear as a
 * degraded block.
 */
const FAILURE_LABELS: Partial<Record<JevFailureCode, string>> = {
  'ERR-01': '网络不可达',
  'ERR-02': '服务超时',
  'ERR-03': '服务异常',
  'ERR-04': 'Key 或配额不可用',
  'ERR-05': '响应不合规',
};

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
  // One guide per extension session, held in memory only: a reloaded window may
  // guide again, which is preferable to persisting anything (`400-build` §3.6).
  const guide = createSessionGuide();

  return [
    vscode.commands.registerCommand(INSPECT_COMMAND, () => runInspection(engine, status, guide)),
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

/** Session-scoped one-shot latch: `claim()` returns `true` at most once. */
export function createSessionGuide(): { claim(): boolean } {
  let claimed = false;
  return {
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
}

/**
 * The wide branch: no key configured (`ADR-006`).
 *
 * The status line always shows the fact; the guide notification appears at most
 * once per session and only when it can still be acted upon. Kept injectable so
 * both halves are unit-testable — a native notification cannot be driven from
 * plain Node.
 */
export interface NoKeyDeps {
  setNoKeyState(): void;
  guide(message: string, action: string): PromiseLike<string | undefined>;
  openSetApiKey(): PromiseLike<void>;
  claimGuide(): boolean;
}

export async function presentNoKey(deps: NoKeyDeps): Promise<void> {
  deps.setNoKeyState();
  if (!deps.claimGuide()) return;

  const choice = await deps.guide(GUIDE_MESSAGE, SET_KEY_ACTION);
  if (choice === SET_KEY_ACTION) await deps.openSetApiKey();
}

/**
 * Aggregate degraded blocks into one line: how many were skipped, and why.
 *
 * Blocks that fail are still real review work, so the count leads and the causes
 * follow — the user can decide whether to re-run or to set a key.
 */
export function describeDegraded(degraded: InspectionReport['degraded']): string {
  if (degraded.length === 0) return '';

  const failed = degraded.reduce((sum, entry) => sum + entry.count, 0);
  const reasons = degraded.map((entry) => FAILURE_LABELS[entry.code] ?? entry.code).join('、');
  return `SoneCheck: 已跳过 ${failed} 块改动（${reasons}）`;
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

async function runInspection(
  engine: RiskEngine,
  status: StatusReporter,
  guide: { claim(): boolean },
): Promise<void> {
  const config = normalizeConfig(readRawConfig());

  if (!config.enabled) {
    await status.notify('SoneCheck: 已在设置中关闭（sonecheck.enabled）');
    return;
  }

  status.set('running');

  try {
    const report = await engine.inspect(config, workspaceRoot());

    if (report.skipped === 'NO_KEY') {
      await presentNoKey({
        setNoKeyState: () => status.set('no-key'),
        guide: (message: string, action: string) => vscode.window.showInformationMessage(message, action),
        openSetApiKey: async () => {
          await vscode.commands.executeCommand(SET_API_KEY_COMMAND);
        },
        claimGuide: () => guide.claim(),
      });
      return;
    }

    if (report.items.length === 0) {
      if (report.degraded.length > 0) {
        // Nothing survived the filter and blocks were dropped: say so instead of
        // showing an empty list.
        status.set('warning');
        await status.notify(describeDegraded(report.degraded), 'warn');
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

    // Valid results come first: the dropped blocks are reported only after the
    // list is closed, never in front of it.
    if (report.degraded.length > 0) {
      await status.notify(describeDegraded(report.degraded), 'warn');
    }
  } catch (error) {
    await reportFailure(error, status);
  }
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
