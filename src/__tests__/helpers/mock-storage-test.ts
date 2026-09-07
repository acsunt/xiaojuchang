/**
 * mock-db / browser-store 等依赖 localStorage / sessionStorage / window.dispatchEvent
 * 的测试都可以从这里拿到一组最小 stub。
 *
 * 使用：
 *   import { setupMockStorageTest } from './helpers/mock-storage-test';
 *   setupMockStorageTest();
 *   // 直接用 localStorage.clear() / localStorage.setItem(...)
 */
import { afterEach, beforeEach, vi } from 'vitest';

const storageStub = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
})();

export const setupMockStorageTest = () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storageStub);
    vi.stubGlobal('sessionStorage', storageStub);
    // mock-db 内部 emit* 函数会调 window.dispatchEvent（仅在有 window 时）。
    // node 没 window，stub 一个最小实现避免 ReferenceError。
    vi.stubGlobal('window', { dispatchEvent: () => undefined });
    storageStub.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
};
