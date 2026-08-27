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
  },
});
