import * as vscode from 'vscode';

/**
 * Status-bar states of one inspection (`04` §2 五态中的四种：空 / 加载 / 成功 / 错误，
 * 外加 `v0.1.1` 的宽限态「未配置 Key」）。
 *
 * `idle` means "no indication": the item is hidden, which is how the extension
 * achieves zero disturbance (`US-03`). `no-key` is deliberately **not** an error
 * state: a missing key skips the inspection (`ADR-006`), and colouring it as a
 * warning would contradict "nothing is broken".
 */
export type StatusState = 'idle' | 'running' | 'clear' | 'empty' | 'warning' | 'no-key';

/** One-shot notifications and the transient status item (`04` §2). */
export interface StatusReporter {
  set(state: StatusState): void;
  notify(message: string, kind?: 'info' | 'warn'): Promise<void>;
  dispose(): void;
}

/** How long the transient states stay visible (`04` §2: All Clear 2s). */
const TRANSIENT_MS = 2000;

/**
 * Create the status reporter.
 *
 * The reporter owns **UI state only** — no business state (`04` §5 item 4): the
 * inspection status machine lives in `core`. Colors come from the theme
 * (`ThemeColor`), never from literals (`04` §3.1 red line).
 */
export function createStatusReporter(): StatusReporter {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.name = 'SoneCheck';

  let hideTimer: NodeJS.Timeout | undefined;

  const cancelTimer = (): void => {
    if (hideTimer !== undefined) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };

  const showTransient = (text: string, background?: vscode.ThemeColor): void => {
    cancelTimer();
    item.text = text;
    item.backgroundColor = background;
    item.show();
    hideTimer = setTimeout(() => item.hide(), TRANSIENT_MS);
  };

  return {
    set(state: StatusState): void {
      cancelTimer();
      switch (state) {
        case 'running':
          item.backgroundColor = undefined;
          item.text = 'SoneCheck: 检查中…';
          item.show();
          break;
        case 'clear':
          showTransient('SoneCheck: All Clear');
          break;
        case 'empty':
          showTransient('SoneCheck: 无改动');
          break;
        case 'warning':
          showTransient('SoneCheck: 已跳过', new vscode.ThemeColor('statusBarItem.warningBackground'));
          break;
        case 'no-key':
          // 宽限态：无错误色、无 spinner——只是「这次没判」（ADR-006）
          showTransient('SoneCheck: 未配置 Key');
          break;
        case 'idle':
        default:
          item.backgroundColor = undefined;
          item.hide();
          break;
      }
    },

    async notify(message: string, kind: 'info' | 'warn' = 'info'): Promise<void> {
      if (kind === 'warn') await vscode.window.showWarningMessage(message);
      else await vscode.window.showInformationMessage(message);
    },

    dispose(): void {
      cancelTimer();
      item.dispose();
    },
  };
}
