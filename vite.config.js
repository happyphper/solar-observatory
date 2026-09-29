import { defineConfig } from 'vite';

// 太阳观察台：纯静态前端，无需后端
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false
  },
  build: {
    target: 'es2022',
    sourcemap: false
  }
});
