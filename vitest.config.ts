import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    // 当前仓库不随版本发布单元测试（本地参考代码见 .gitignore 列出的几个 .test.ts），
    // 所以 glob 可能命中 0 个文件，让 vitest 在找不到测试时直接通过而不是报错。
    passWithNoTests: true,
    // node:sqlite 目前是 Node 的实验性 API，运行测试时会打印噪音警告，这里通过子进程参数静音。
    execArgv: ['--no-warnings'],
    // vitest 4 用 projects 配置把不同环境拆开:
    //   - 默认项目(node)覆盖所有 *.test.ts,走 mock-db / zip / 序列化等纯逻辑
    //   - browser 项目单独跑 src/__tests__/browser/**,环境是 happy-dom(以后想换 jsdom 改这一处)
    //
    // 跑法:
    //   npx vitest run                       # 两个项目都跑(默认行为)
    //   npx vitest run --project node        # 只跑 node 项目
    //   npx vitest run --project browser     # 只跑 browser 项目
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'functions/**/__tests__/**/*.test.ts',
            'src/**/__tests__/**/*.test.ts',
            // 显式排除 browser 目录,避免重复匹配
            '!src/__tests__/browser/**',
          ],
          passWithNoTests: true,
          execArgv: ['--no-warnings'],
        },
      },
      {
        test: {
          name: 'browser',
          environment: 'happy-dom',
          include: ['src/**/__tests__/browser/**/*.{test.ts,test.tsx}'],
          passWithNoTests: true,
          // 引入 @testing-library/jest-dom/vitest,解锁 .toBeInTheDocument() / .toHaveTextContent() 等 matcher
          setupFiles: ['@testing-library/jest-dom/vitest'],
        },
      },
    ],
  },
});
