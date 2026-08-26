import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    // node:sqlite 目前是 Node 的实验性 API，运行测试时会打印噪音警告，这里通过子进程参数静音。
    execArgv: ['--no-warnings'],
  },
});
