import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * T1 configuration (`01` §3): unit tests run in pure Node, so the `vscode` module
 * — which only exists inside the extension host — is aliased to a stub. Nothing
 * else is relaxed: the real module graph, the real (network-free) implementations
 * and the real assertions stay in place.
 */
export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // T1 only: pure Node, no sockets. T2 lives in `vitest.integration.config.mts`.
    include: ['test/*.test.ts'],
  },
});
