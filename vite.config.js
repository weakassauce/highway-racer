import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      '/forge': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/forge/, '/api/v1'),
      },
    },
  },
});
