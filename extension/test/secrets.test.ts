import { describe, expect, it } from 'vitest';

import { createSecrets } from '../src/infra';
import type { SecretStoragePort } from '../src/infra';

const KEY = 'apikey_secret_value_for_test';

/**
 * In-memory stand-in for `context.secrets`.
 *
 * It records every operation so the tests can assert not just the resulting
 * value but also *how* it was stored — an empty string must never be written
 * through, and the plaintext must not travel anywhere except `store`.
 */
function fakeStorage(): SecretStoragePort & { calls: string[]; written: Map<string, string> } {
  const calls: string[] = [];
  const written = new Map<string, string>();
  return {
    calls,
    written,
    async get(key) {
      calls.push('get');
      return written.get(key);
    },
    async store(key, value) {
      calls.push('store');
      written.set(key, value);
    },
    async delete(key) {
      calls.push('delete');
      written.delete(key);
    },
  };
}

describe('createSecrets', () => {
  it('未配置时：hasApiKey=false 且 getApiKey 返回 null（不抛错）', async () => {
    const secrets = createSecrets(fakeStorage());

    expect(await secrets.hasApiKey()).toBe(false);
    expect(await secrets.getApiKey()).toBeNull();
  });

  it('写入后可读回原值（幂等：后写覆盖前写）', async () => {
    const storage = fakeStorage();
    const secrets = createSecrets(storage);

    await secrets.setApiKey('first');
    await secrets.setApiKey(KEY);

    expect(await secrets.hasApiKey()).toBe(true);
    expect(await secrets.getApiKey()).toBe(KEY);
    expect(storage.written.size).toBe(1);
  });

  it('写入空串等价于清除（不落盘空值）', async () => {
    const storage = fakeStorage();
    const secrets = createSecrets(storage);

    await secrets.setApiKey(KEY);
    await secrets.setApiKey('');

    expect(await secrets.hasApiKey()).toBe(false);
    expect(await secrets.getApiKey()).toBeNull();
    expect(storage.calls).toContain('delete');
    expect([...storage.written.values()]).not.toContain('');
  });

  it('空串清除在未配置时是幂等空操作', async () => {
    const storage = fakeStorage();
    const secrets = createSecrets(storage);

    await secrets.setApiKey('');
    await secrets.clearApiKey();
    await secrets.clearApiKey();

    expect(await secrets.hasApiKey()).toBe(false);
  });

  it('clearApiKey 清除已配置的值', async () => {
    const secrets = createSecrets(fakeStorage());

    await secrets.setApiKey(KEY);
    await secrets.clearApiKey();

    expect(await secrets.hasApiKey()).toBe(false);
  });

  it('底层读取到空串时视为未配置（不返回空 Key）', async () => {
    const storage = fakeStorage();
    await storage.store('sonecheck.jevApiKey', '');
    const secrets = createSecrets(storage);

    expect(await secrets.hasApiKey()).toBe(false);
    expect(await secrets.getApiKey()).toBeNull();
  });

  it('INV-03：明文只经 getApiKey 单向流出，不出现在接口表面与状态里', async () => {
    const storage = fakeStorage();
    const secrets = createSecrets(storage);

    await secrets.setApiKey(KEY);

    // 接口表面（函数名 + 可枚举状态）不含明文
    expect(JSON.stringify(Object.keys(secrets))).not.toContain(KEY);
    // 可读性是布尔，不携带明文
    expect(await secrets.hasApiKey()).toBe(true);
    // 明文的唯一两条出口：存储介质与 getApiKey
    expect([...storage.written.values()]).toEqual([KEY]);
    expect(await secrets.getApiKey()).toBe(KEY);
    // 清除是无返回值操作，同样不携带明文
    expect(await secrets.clearApiKey()).toBeUndefined();
    expect(await secrets.hasApiKey()).toBe(false);
  });

  it('底层异常原样上抛，不被改写成「未配置」（ERR-08 语义不同）', async () => {
    const boom = new Error('keychain locked');
    const secrets = createSecrets({
      async get() {
        throw boom;
      },
      async store() {
        throw boom;
      },
      async delete() {
        throw boom;
      },
    });

    await expect(secrets.hasApiKey()).rejects.toBe(boom);
    await expect(secrets.getApiKey()).rejects.toBe(boom);
    await expect(secrets.setApiKey(KEY)).rejects.toBe(boom);
    await expect(secrets.clearApiKey()).rejects.toBe(boom);
  });
});
