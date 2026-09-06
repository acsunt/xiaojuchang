import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    /* 项目是单页应用 + 私有审核后台，路由级代码分割的收益小（外部访客进不来，
     * 老用户缓存命中率高），但拆分会让首次进入审核后台多一次 chunk 下载，体验更差。
     * 当前主 chunk ~577 KB / gzipped 165 KB，对个人项目完全够用，调大阈值消除无害的
     * build 警告。等真有性能问题再做拆分。 */
    chunkSizeWarningLimit: 1000,
  },
});
