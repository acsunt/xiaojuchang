# `src/__tests__/` 测试切片策略

本目录是「本地回归冒烟测试」——改完代码 `npm run test` 跑一遍,确认 URL/方法/纯函数行为没退化。

不做的事:

- 后端 `functions/api/**` 集成测试(需要 Cloudflare Workers + D1 mock,投入产出比不划算)
- React 组件 / 页面快照测试(超出"本地冒烟"初衷)
- 性能 / 加载时间测试

## 切片文件命名

按"功能面"切,每个面一个文件:

```
play-api.continuations.test.ts      ← 续写相关 API
play-api.plays-public.test.ts       ← 公开 plays / tags / settings
play-api.plays-submit.test.ts       ← 投稿 / 编辑
play-api.repos.test.ts              ← 公开 repos
play-api.admin-auth.test.ts         ← 管理员登录 / 会话 / 登出
play-api.admin-plays.test.ts        ← 管理员对 play 的所有操作
play-api.admin-repos.test.ts        ← 管理员对 repo 的所有操作
play-api.admin-meta.test.ts         ← tags / settings / 备份 / 通知 / 审计
play-text.test.ts                   ← play-text.ts 纯函数(文本解析/序列化/批量)
```

命名约定:`play-api.<面>.test.ts` 是网络层,`<模块名>.test.ts` 是纯函数层。

## 共享 setup

所有 `play-api.*.test.ts` 都从 `./helpers/play-api-test` 导入 setup:

```ts
import { setupPlayApiTest } from './helpers/play-api-test';
const { importApi, fetchMock } = setupPlayApiTest();
```

setup 帮你处理:

- 把 `apiMode` 切到 `'remote'`(否则会走 local 分支)
- 把 `mockDb` 包成"被调就抛"的 Proxy(防止误入 local 分支)
- 补 node 没有的 `localStorage` / `sessionStorage`
- 把 `fetch` 替换成可 spy 的 mock

纯函数切片(像 `play-text.test.ts`)不需要这套,直接 import 即可。

## 编写约定

1. **断言"发了什么请求"为主** —— URL、HTTP 方法、body 形状、headers。
2. **边界单独写一个 `it`** —— 空字符串、空数组、URL 编码、4xx 解析、localStorage 副作用。
3. **fetchMock 默认返回 `[]`** —— 大多数 API 返回数组;返回单个 Play 的方法需要 `mockResolvedValueOnce({ id, summary: 's' })`(因为 `normalizePlaySummary` 会调 `.trim()`)。
4. **不要断言 fetchMock 的完整 args** —— 用 `expect(url).toBe(...)` 和 `expect(init?.method).toBe(...)` 分开写,失败信息更清楚。

## 运行

```bash
npm run test              # 全量一次,约 3 秒
npm run test:watch        # 监听模式,改完自动重跑
npm run test:related      # 只跑相关文件(改了 src/services/play-api.ts 就跑所有 play-api.*.test.ts)
npm run test:play-api     # 只跑 play-api 切片(8 个文件)
```
