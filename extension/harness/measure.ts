/**
 * Mock 分布测量（`v0.1.0` S2 产物，2026-09-23 收口时运行；`v0.1.1` S3 起保留为
 * 「mock 侧对照」，与 `calibrate.ts` 共用 `harness/samples.ts` 的样本）。
 *
 * 跑纯 core 侧的四维加权打分（打分器现为测试夹具 `test/fixtures/jevScoring.ts`，
 * 因为 `v0.1.1` 起扩展不再内置 mock 判定器），输出 score / 上下文字节 / 归因 / 阈值
 * 敏感性的分布，供 `riskThreshold` 与 payload 上限定案（`dev-meta/docs/02-version-rules.md` §6.3）。
 *
 * Dev-only, one-shot script: not part of the packaged extension, and never
 * imported by `src/`. Run with `npx tsx harness/measure.ts`.
 */

import { MAX_PAYLOAD_BYTES, RISK_THRESHOLD } from '../src/constants';
import { scoreHunk } from '../test/fixtures/jevScoring';
import type { DecisionPolicy } from '../src/infra';

import { HISTORY_COMMITS, buildPayload, collectSamples, percentile } from './samples';

const POLICY: DecisionPolicy = {
  sensitivePathPatterns: ['auth', 'payment', 'migration'],
  riskThreshold: RISK_THRESHOLD,
};

const THRESHOLD_SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9];

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function main(): void {
  const samples = collectSamples();
  const historyCount = samples.filter((sample) => sample.source === 'history').length;

  out('# S2 Harness 实测数据');
  out();
  out(`- 样本来源：本项目 git 历史（最近 ${HISTORY_COMMITS} 个提交，${historyCount} 个 hunk）+ 构造样本（${samples.length - historyCount} 个 hunk）`);
  out(`- 权重与阈值：阈值 ${POLICY.riskThreshold}，敏感路径 ${POLICY.sensitivePathPatterns.join(' / ')}`);
  out();

  if (samples.length === 0) {
    out('无样本，无法给出分布。');
    return;
  }

  const scores: number[] = [];
  const contextBytes: number[] = [];
  const reasonCounts = new Map<string, number>();
  let overflow = 0;
  let fallbackSources = 0;

  for (const sample of samples) {
    const { payload, fromFile } = buildPayload(sample);
    if (!fromFile) fallbackSources += 1;

    const result = scoreHunk({ payload, policy: POLICY });
    scores.push(result.score);
    contextBytes.push(Buffer.byteLength(payload.contextCode, 'utf8'));
    reasonCounts.set(result.reasonCode, (reasonCounts.get(result.reasonCode) ?? 0) + 1);

    const wire = JSON.stringify({
      file_path: payload.filePath,
      change_type: payload.changeType,
      diff_hunk: payload.diffHunk,
      context_code: payload.contextCode,
    });
    if (Buffer.byteLength(wire, 'utf8') > MAX_PAYLOAD_BYTES) overflow += 1;
  }

  scores.sort((a, b) => a - b);
  contextBytes.sort((a, b) => a - b);

  out('## score 分布');
  out();
  out(`- min ${scores[0].toFixed(3)} · p50 ${percentile(scores, 0.5).toFixed(3)} · p90 ${percentile(scores, 0.9).toFixed(3)} · max ${scores[scores.length - 1].toFixed(3)}`);
  out();
  out('| 区间 | hunk 数 |');
  out('|---|---|');
  for (let bucket = 0; bucket < 10; bucket += 1) {
    const low = bucket / 10;
    const high = low + 0.1;
    const count = scores.filter((score) => score >= low && (bucket === 9 ? score <= high : score < high)).length;
    out(`| ${low.toFixed(1)}–${high.toFixed(1)} | ${count} |`);
  }
  out();

  out('## context_code 字节数分布');
  out();
  out(`- min ${contextBytes[0]} · p50 ${percentile(contextBytes, 0.5)} · p90 ${percentile(contextBytes, 0.9)} · max ${contextBytes[contextBytes.length - 1]}`);
  out();

  out('## reason_code 归因分布');
  out();
  out('| reason_code | hunk 数 |');
  out('|---|---|');
  for (const [reason, count] of [...reasonCounts.entries()].sort()) {
    out(`| ${reason} | ${count} |`);
  }
  out();

  out('## 阈值敏感性（AUDIT 命中数）');
  out();
  out(`| 阈值 | AUDIT 数 | 占样本比 |`);
  out('|---|---|---|');
  for (const threshold of THRESHOLD_SWEEP) {
    const hits = scores.filter((score) => score >= threshold).length;
    out(`| ${threshold.toFixed(1)} | ${hits} | ${((hits / scores.length) * 100).toFixed(1)}% |`);
  }
  out();

  out('## 边界检查');
  out();
  out(`- payload 超出 INV-02 上限的 hunk 数：${overflow}`);
  out(`- 历史文件缺失、改用 hunk 自身行做上下文的样本数：${fallbackSources}`);

  if (overflow > 0) {
    process.exitCode = 1;
    out();
    out('❌ INV-02 被突破，S3 定案前必须修复。');
  }
}

main();
