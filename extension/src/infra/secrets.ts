/**
 * API Key read/write — the **only** place that touches SecretStorage
 * (`INV-03`, `02` §2 `infra/secrets`).
 *
 * Two deliberate design choices:
 *
 * 1. **No `vscode` import.** The host API arrives as a structural
 *    {@link SecretStoragePort}, so this module is pure logic. Anything that
 *    imports it — core, the T1 suite, dev scripts — stays runnable outside the
 *    extension host (the same reason `harness/vscode-shim.cjs` exists).
 * 2. **The key never appears in a return value, a message or a log.** Only
 *    `getApiKey` hands the plaintext to the decision client, and the decision
 *    client puts it in the `Authorization` header and nowhere else.
 *
 * Storage failures (an OS keychain that is locked, for instance) propagate to
 * the caller unchanged: they are neither swallowed nor rewritten into
 * `ERR-08`, which means "not configured" — a different fact.
 */

export interface SecretStoragePort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/** Public surface of the key vault, frozen in S1 and mirrored in `02` §2. */
export interface Secrets {
  /** Readability probe used by the wide branch before any decision call. */
  hasApiKey(): Promise<boolean>;
  /** The plaintext, or `null` when unset. Never logged, never returned upward. */
  getApiKey(): Promise<string | null>;
  /** Writing an empty string clears the key instead of storing an empty one. */
  setApiKey(value: string): Promise<void>;
  clearApiKey(): Promise<void>;
}

/** Storage key — this literal must stay in this file alone (`GUARD-06`). */
const SECRET_KEY = 'sonecheck.jevApiKey';

export function createSecrets(storage: SecretStoragePort): Secrets {
  const read = async (): Promise<string | undefined> => {
    const value = await storage.get(SECRET_KEY);
    return value === undefined || value === '' ? undefined : value;
  };

  return {
    async hasApiKey(): Promise<boolean> {
      return (await read()) !== undefined;
    },
    async getApiKey(): Promise<string | null> {
      return (await read()) ?? null;
    },
    async setApiKey(value: string): Promise<void> {
      if (value === '') {
        await storage.delete(SECRET_KEY);
        return;
      }
      await storage.store(SECRET_KEY, value);
    },
    async clearApiKey(): Promise<void> {
      await storage.delete(SECRET_KEY);
    },
  };
}
