import { describe, expect, it, vi } from 'vitest';

import { runSetApiKey } from '../src/ui/commands';
import type { SetApiKeyDeps } from '../src/ui/commands';

const KEY = 'apikey_secret_value_for_test';

/**
 * `API-03` as a pure flow (`ERR-10` / `ERR-11`).
 *
 * The point of these cases is the *side effects*: a dismissed input must write
 * nothing, a declined confirmation must keep the stored key, and no branch may
 * echo the plaintext back to the user (`INV-03`).
 */
function deps(overrides: Partial<SetApiKeyDeps> = {}): SetApiKeyDeps & {
  notify: ReturnType<typeof vi.fn>;
  setApiKey: ReturnType<typeof vi.fn>;
  clearApiKey: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
} {
  const notify = vi.fn(async () => undefined);
  const setApiKey = vi.fn(async () => undefined);
  const clearApiKey = vi.fn(async () => undefined);
  const confirm = vi.fn(async () => true);
  const hasApiKey = vi.fn(async () => true);

  return {
    hasApiKey,
    setApiKey,
    clearApiKey,
    promptInput: async () => KEY,
    confirm,
    notify,
    ...overrides,
  } as SetApiKeyDeps & {
    notify: ReturnType<typeof vi.fn>;
    setApiKey: ReturnType<typeof vi.fn>;
    clearApiKey: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
  };
}

describe('runSetApiKey', () => {
  it('写入合法值并提示已保存', async () => {
    const d = deps();

    await runSetApiKey(d);

    expect(d.setApiKey).toHaveBeenCalledWith(KEY);
    expect(d.notify).toHaveBeenCalledWith('SoneCheck: 已保存 Jev API Key');
  });

  it('ERR-10 取消输入：无写入、无提示（无副作用即无痕迹）', async () => {
    const d = deps({ promptInput: async () => undefined });

    await runSetApiKey(d);

    expect(d.setApiKey).not.toHaveBeenCalled();
    expect(d.clearApiKey).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('ERR-11 空串且确认清除：调用 clearApiKey 并提示', async () => {
    const d = deps({ promptInput: async () => '' });

    await runSetApiKey(d);

    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.clearApiKey).toHaveBeenCalledTimes(1);
    expect(d.setApiKey).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith('SoneCheck: 已清除 Jev API Key');
  });

  it('ERR-11 二次确认为否：保留原值，不清除也不写入', async () => {
    const d = deps({ promptInput: async () => '  ', confirm: async () => false });

    await runSetApiKey(d);

    expect(d.clearApiKey).not.toHaveBeenCalled();
    expect(d.setApiKey).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith('SoneCheck: 已保留原有 API Key');
  });

  it('未配置 Key 时输入空串：不弹确认，直接告知无需清除', async () => {
    const d = deps({ promptInput: async () => '', hasApiKey: async () => false });

    await runSetApiKey(d);

    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.clearApiKey).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith('SoneCheck: 未配置 API Key，无需清除');
  });

  it('INV-03：任何分支都不把 Key 明文送进提示文案', async () => {
    for (const input of [KEY, '', '   ', undefined]) {
      const d = deps({ promptInput: async () => input });

      await runSetApiKey(d);

      for (const call of d.notify.mock.calls) {
        expect(String(call[0])).not.toContain(KEY);
      }
    }
  });
});
