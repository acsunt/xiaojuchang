/**
 * play-api.ts 的测试基础设施：把"切到 remote 分支 + 拦住 fetch + 补上 node 缺的全局"
 * 这一坨样板代码抽出来，让每个切片的测试只关心"发了什么请求"。
 *
 * 每个切片测试文件都长这样：
 *   import { setupPlayApiTest, type PlayApiFixture } from './helpers/play-api-test';
 *   const { importApi, fetchMock } = setupPlayApiTest();
 *   it('xxx', async () => {
 *     const playApi = await importApi();
 *     await playApi.xxx();
 *     expect(fetchMock).toHaveBeenCalledWith(...);
 *   });
 */
import { afterEach, beforeEach, vi, type Mock } from 'vitest';

// vi.mock / vi.stubEnv 必须在模块顶层调用 —— 否则 vitest 内部 hoist 会触发警告。
// play-api.ts 在模块顶层把 apiMode 求值：
//   const apiMode = import.meta.env.VITE_API_MODE ?? (import.meta.env.DEV ? 'local' : 'remote');
// vitest 默认 import.meta.env.DEV === true，所以 apiMode 会是 'local'。
// vi.stubEnv 会改 import.meta.env 的运行时值，但模块顶层 const 只在 import 时求值一次，
// 因此 stubEnv 必须在 importApi() 之前生效（每个 beforeEach 会 resetModules + 动态 import）。
vi.stubEnv('VITE_API_MODE', 'remote');

// 顺手把 mockDb 整体替换：万一漏走到 local 分支，立刻爆错提示回归。
vi.mock('../../data/mock-db', () => ({
  mockDb: new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('mockDb 不应在 remote 分支被调用');
      },
    },
  ),
}));

export type PlayApiFixture = {
  /** 动态 import playApi；保证 stubEnv / stubGlobal 生效后再读 apiMode。 */
  importApi: () => Promise<typeof import('../../services/play-api').playApi>;
  /** spy 出来的 fetch mock，每个测试用例前自动 reset。 */
  fetchMock: Mock;
};

const fetchMock = vi.fn();

// play-api.ts 静态 import 了 mock-db.ts，里面用了 localStorage/sessionStorage；
// node 环境没有这俩全局。给它们补一个最小 stub（仅冒烟测试需要，不还原业务行为）。
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

beforeEach(() => {
  fetchMock.mockReset();
  // 大多数 playApi 方法返回数组（或经过 null 检查后返回 null），
  // 默认空数组可以让 .map([]) 这种消费行为不爆；具体测试需要复杂响应时
  // 用 mockResolvedValueOnce(...) 覆盖单次。
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', storageStub);
  vi.stubGlobal('sessionStorage', storageStub);
  // 清掉跨测试共享的缓存 / pending promise（getPublicPlays 用了 module-scoped 单飞）
  // 通过重置模块实现 import.meta.env 之外的状态隔离。
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const importApi = async () => {
  const mod = await import('../../services/play-api');
  return mod.playApi;
};

/**
 * 用例可以在 beforeEach 后用 mockResolvedValueOnce(...) 覆盖单次响应。
 * 不用 setup 函数包一层了 —— 直接 import importApi + fetchMock 就够。
 */
export const setupPlayApiTest = (): PlayApiFixture => ({ importApi, fetchMock });
