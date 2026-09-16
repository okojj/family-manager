import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [vue()], server: { host: 'localhost', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } }, build: { outDir: '../../dist/web', emptyOutDir: true } });
