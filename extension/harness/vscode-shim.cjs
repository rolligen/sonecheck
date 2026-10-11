/**
 * `vscode` 模块桩 —— 仅供 `harness/` 下的 dev-only 脚本在 Node 中运行。
 *
 * 为什么需要：Facade 桶文件（`src/infra/index.ts`）会传递引入 `configSource.ts`，
 * 而后者 `require('vscode')`——该模块只存在于扩展宿主里。harness 跑在扩展宿主之外，
 * 于是链路在导入阶段就断了（`Cannot find module 'vscode'`）。
 *
 * 为什么不改架构：把 `configSource` 改成注入式属于 S4 的接线范围；为了让一次性测量
 * 脚本提前改动 Facade 或分层纪律不划算。T1 单测用 vitest 的 `vscode` alias 解决同一
 * 问题（`vitest.config.mts`），此处是脚本世界的等价物。
 *
 * 提供的表面仅够 harness 走到「导入完成」：`workspace.getConfiguration` 返回默认值、
 * `workspace.workspaceFolders` 为空。harness 不读用户设置。
 *
 * 用法（NODE_OPTIONS 会作用于 tsx 派生的 node 进程）：
 *   NODE_OPTIONS="--require $PWD/harness/vscode-shim.cjs" npx tsx harness/measure.ts
 *   NODE_OPTIONS="--require $PWD/harness/vscode-shim.cjs" npx tsx harness/calibrate.ts --latency 100
 */

const Module = require('node:module');

const vscodeStub = {
  workspace: {
    getConfiguration: () => ({
      get: (_key, defaultValue) => defaultValue,
      has: () => false,
      inspect: () => undefined,
      update: async () => undefined,
    }),
    workspaceFolders: undefined,
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
};

const load = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return load.call(this, request, parent, isMain);
};
