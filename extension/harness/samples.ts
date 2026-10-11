/**
 * 共享样本采集 —— `harness/measure.ts`（`v0.1.0` 的 mock 分布测量）与
 * `harness/calibrate.ts`（`v0.1.1` 的端点校准）共用同一批样本与同一套 payload 组装。
 *
 * 单一来源的意义：两条测量链的输入必须完全一致，否则「mock 分布」与「真实分布」不可比。
 *
 * Dev-only, one-shot support module: not part of the packaged extension, never
 * imported by `src/`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { buildContext } from '../src/core';
import { parseDiff } from '../src/infra';
import type { Hunk, HunkPayload } from '../src/infra';

export const REPO_ROOT = resolve(dirname(__filename ?? '.'), '..', '..');

export const HISTORY_COMMITS = 40;

export interface Sample {
  source: 'history' | 'constructed';
  hunk: Hunk;
  /** `true` when the real file content was available for context building. */
  usedSourceFile: boolean;
}

export const CONSTRUCTED_DIFFS: ReadonlyArray<{ name: string; diff: string }> = [
  {
    name: 'auth 边界（token 校验）',
    diff: [
      'diff --git a/src/auth/token.ts b/src/auth/token.ts',
      '--- a/src/auth/token.ts',
      '+++ b/src/auth/token.ts',
      '@@ -12,7 +12,9 @@ export function verify(token: string) {',
      '   const secret = loadSecret();',
      '-  return jwt.verify(token, secret);',
      '+  if (!token) return null;',
      '+  return jwt.verify(token, secret);',
      ' }',
    ].join('\n'),
  },
  {
    name: '数据写入（事务边界）',
    diff: [
      'diff --git a/src/billing/payment-store.ts b/src/billing/payment-store.ts',
      '--- a/src/billing/payment-store.ts',
      '+++ b/src/billing/payment-store.ts',
      '@@ -30,6 +30,7 @@ export async function settle(order) {',
      '   await db.transaction(async (tx) => {',
      '+    await tx.update("orders", order.id, { paid: true });',
      '     return order;',
      '   });',
    ].join('\n'),
  },
  {
    name: '契约破坏（导出签名）',
    diff: [
      'diff --git a/src/api/client.ts b/src/api/client.ts',
      '--- a/src/api/client.ts',
      '+++ b/src/api/client.ts',
      '@@ -1,4 +1,4 @@',
      '-export function request(url: string): Promise<Response>',
      '+export function request(url: string, retries: number): Promise<Response>',
    ].join('\n'),
  },
  {
    name: '错误处理（吞掉异常）',
    diff: [
      'diff --git a/src/worker/job.ts b/src/worker/job.ts',
      '--- a/src/worker/job.ts',
      '+++ b/src/worker/job.ts',
      '@@ -20,6 +20,7 @@ export async function run(job) {',
      '   try {',
      '     await job.execute();',
      '+  } catch (error) {}',
      ' }',
    ].join('\n'),
  },
  {
    name: '纯样式（引号与空行）',
    diff: [
      'diff --git a/src/util/format.ts b/src/util/format.ts',
      '--- a/src/util/format.ts',
      '+++ b/src/util/format.ts',
      '@@ -5,3 +5,3 @@',
      "-const sep = ':'",
      '+const sep = ":"',
    ].join('\n'),
  },
  {
    name: 'migration（建表语句）',
    diff: [
      'diff --git a/db/migration/001_init.sql b/db/migration/001_init.sql',
      '--- a/db/migration/001_init.sql',
      '+++ b/db/migration/001_init.sql',
      '@@ -1,2 +1,3 @@',
      ' CREATE TABLE users (id INTEGER);',
      '+DROP TABLE legacy_users;',
    ].join('\n'),
  },
];

function readHistoryDiff(): string {
  try {
    return execFileSync('git', ['log', '-p', '--no-merges', `-n${HISTORY_COMMITS}`, '--format='], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return `history 读取失败：${(error as Error).message}`;
  }
}

export function collectSamples(): Sample[] {
  const samples: Sample[] = [];

  for (const hunk of parseDiff(readHistoryDiff())) {
    samples.push({ source: 'history', hunk, usedSourceFile: true });
  }

  for (const entry of CONSTRUCTED_DIFFS) {
    for (const hunk of parseDiff(entry.diff)) {
      samples.push({ source: 'constructed', hunk, usedSourceFile: false });
    }
  }

  return samples;
}

function sourceLinesFor(hunk: Hunk): { lines: string[]; fromFile: boolean } {
  const absolute = isAbsolute(hunk.filePath) ? hunk.filePath : join(REPO_ROOT, hunk.filePath);
  try {
    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
    return { lines, fromFile: true };
  } catch {
    // Historical or deleted file: fall back to the hunk's own lines so that the
    // context pipeline is still exercised.
    return { lines: hunk.diffContent.split('\n'), fromFile: false };
  }
}

export function buildPayload(sample: Sample): { payload: HunkPayload; fromFile: boolean } {
  const { lines, fromFile } = sourceLinesFor(sample.hunk);
  return {
    payload: {
      filePath: sample.hunk.filePath,
      changeType: sample.hunk.changeType,
      diffHunk: sample.hunk.diffContent,
      contextCode: buildContext(sample.hunk, lines),
    },
    fromFile,
  };
}

export function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

/**
 * Payloads for `count` samples, **interleaved across sources**.
 *
 * Interleaving matters: history contributes hundreds of hunks while constructed
 * samples contribute a handful, so taking a prefix would measure only real
 * project changes and silently exclude the high-risk scenarios (auth / payment /
 * migration) the constructed set exists to cover.
 */
export function takePayloads(count: number): HunkPayload[] {
  const samples = collectSamples();
  const history = samples.filter((sample) => sample.source === 'history');
  const constructed = samples.filter((sample) => sample.source === 'constructed');
  const ordered: Sample[] = [];

  for (let index = 0; ordered.length < Math.min(count, samples.length); index += 1) {
    if (index < constructed.length) ordered.push(constructed[index]);
    if (ordered.length < count && index < history.length) ordered.push(history[index]);
  }

  return ordered.slice(0, count).map((sample) => buildPayload(sample).payload);
}
