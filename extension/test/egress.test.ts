import { describe, expect, it, vi } from 'vitest';

import { createSessionGuide, describeDegraded, presentNoKey } from '../src/ui/commands';

const ACTION = '设置 Key';

function noKeyDeps(choice: string | undefined = undefined) {
  const setNoKeyState = vi.fn();
  const guide = vi.fn(async () => choice);
  const openSetApiKey = vi.fn(async () => undefined);
  const claimGuide = vi.fn(() => true);
  return { setNoKeyState, guide, openSetApiKey, claimGuide };
}

describe('presentNoKey · 宽限分支（ADR-006）', () => {
  it('首次：状态栏置宽限态 + 一次性引导 + 点按钮才打开设置命令', async () => {
    const deps = noKeyDeps(ACTION);

    await presentNoKey(deps);

    expect(deps.setNoKeyState).toHaveBeenCalledTimes(1);
    expect(deps.guide).toHaveBeenCalledTimes(1);
    expect(deps.guide.mock.calls[0][1]).toBe(ACTION);
    expect(deps.openSetApiKey).toHaveBeenCalledTimes(1);
  });

  it('引导被忽略（无返回）：不执行任何命令，无残留', async () => {
    const deps = noKeyDeps(undefined);

    await presentNoKey(deps);

    expect(deps.guide).toHaveBeenCalledTimes(1);
    expect(deps.openSetApiKey).not.toHaveBeenCalled();
  });

  it('第二次检查：引导被 claim 拦下，但状态栏仍提示（宽限可见性不丢失）', async () => {
    const guide = createSessionGuide();
    const first = { ...noKeyDeps(undefined), claimGuide: () => guide.claim() };
    const second = { ...noKeyDeps(undefined), claimGuide: () => guide.claim() };

    await presentNoKey(first);
    await presentNoKey(second);

    expect(first.guide).toHaveBeenCalledTimes(1);
    expect(second.guide).not.toHaveBeenCalled();
    expect(second.setNoKeyState).toHaveBeenCalledTimes(1);
  });

  it('会话标记：claim 只在第一次返回 true', () => {
    const guide = createSessionGuide();

    expect(guide.claim()).toBe(true);
    expect(guide.claim()).toBe(false);
    expect(guide.claim()).toBe(false);
  });
});

describe('describeDegraded · 降级聚合文案', () => {
  it('单一归因：块数在前、原因在后', () => {
    expect(describeDegraded([{ code: 'ERR-02', count: 3 }])).toBe('SoneCheck: 已跳过 3 块改动（服务超时）');
  });

  it('多类归因：按报告顺序拼接、块数合计', () => {
    const text = describeDegraded([
      { code: 'ERR-01', count: 2 },
      { code: 'ERR-04', count: 1 },
    ]);

    expect(text).toBe('SoneCheck: 已跳过 3 块改动（网络不可达、Key 或配额不可用）');
  });

  it('五类错误码各有可读标签', () => {
    for (const code of ['ERR-01', 'ERR-02', 'ERR-03', 'ERR-04', 'ERR-05'] as const) {
      expect(describeDegraded([{ code, count: 1 }])).not.toContain(code);
    }
  });

  it('无降级：返回空串（不产生提示）', () => {
    expect(describeDegraded([])).toBe('');
  });
});
