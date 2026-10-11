import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * T2 contract tests: the decision call crosses a process boundary (real HTTP
 * against `tools/jev-mock/`), so these cases live in their own project with
 * their own include pattern and a raised timeout budget (`01` §3).
 *
 * The `vscode` alias is kept so the same stub resolves if a UI type ever leaks
 * into an integration assertion — nothing else is relaxed.
 */
export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Real sockets plus a deliberate 3s hang for the timeout case.
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
