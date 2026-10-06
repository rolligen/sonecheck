import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRiskEngine, normalizeConfig } from '../src/core';
import { LocalFailure, readSourceLines, readStagedDiff, resolveRepoRoot } from '../src/infra';
import { createMockJevClient } from './fixtures/jevScoring';

const created: string[] = [];

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sonecheck-engine-'));
  created.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'SoneCheck Test'], { cwd: dir });
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  mkdirSync(join(dir, 'src', 'util'), { recursive: true });
  writeFileSync(join(dir, 'src', 'auth', 'login.ts'), 'export function login() {\n  return true;\n}\n');
  writeFileSync(join(dir, 'src', 'util', 'format.ts'), "export const sep = ':';\n");
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

/** Real IO capabilities + the v0.1.0 mock client: the wiring `extension.ts` performs. */
const engine = createRiskEngine({
  resolveRepoRoot,
  readStagedDiff,
  readSourceLines,
  createClient: createMockJevClient,
});

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe('riskEngine.inspect', () => {
  it('敏感路径改动进入清单并归因 AUTH_BOUNDARY', async () => {
    const dir = createRepo();
    writeFileSync(
      join(dir, 'src', 'auth', 'login.ts'),
      'export function login() {\n  if (!token) return null;\n  return true;\n}\n',
    );
    execFileSync('git', ['add', '.'], { cwd: dir });

    const items = await engine.inspect(normalizeConfig({}), dir);

    expect(items).toHaveLength(1);
    expect(items[0].filePath).toBe('src/auth/login.ts');
    expect(items[0].reasonCode).toBe('AUTH_BOUNDARY');
  });

  it('纯样式改动不产出条目（零打扰分支）', async () => {
    const dir = createRepo();
    writeFileSync(join(dir, 'src', 'util', 'format.ts'), 'export const sep = ":";\n');
    execFileSync('git', ['add', '.'], { cwd: dir });

    expect(await engine.inspect(normalizeConfig({}), dir)).toEqual([]);
  });

  it('无暂存改动时抛出分类失败 ERR-07', async () => {
    const dir = createRepo();

    await expect(engine.inspect(normalizeConfig({}), dir)).rejects.toBeInstanceOf(LocalFailure);
    await expect(engine.inspect(normalizeConfig({}), dir)).rejects.toMatchObject({ code: 'ERR-07' });
  });

  it('enabled=false 时短路返回空数组（不检查、不提示）', async () => {
    const dir = createRepo();

    expect(await engine.inspect(normalizeConfig({ enabled: false }), dir)).toEqual([]);
  });

  it('清单项可定位（filePath 与行号在真实文件中存在）', async () => {
    const dir = createRepo();
    writeFileSync(
      join(dir, 'src', 'auth', 'login.ts'),
      'export function login() {\n  if (!token) return null;\n  return true;\n}\n',
    );
    execFileSync('git', ['add', '.'], { cwd: dir });

    const items = await engine.inspect(normalizeConfig({}), dir);
    const root = resolveRepoRoot(dir);

    for (const item of items) {
      const lines = readSourceLines(root, item.filePath);
      expect(lines.length).toBeGreaterThanOrEqual(item.startLine);
    }
  });
});
