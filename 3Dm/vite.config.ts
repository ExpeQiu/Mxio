import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const port = Number(process.env.VELXIO_3DM_PORT ?? 5174);

export default defineConfig({
  root: resolve(__dirname, 'src/app'),
  publicDir: resolve(__dirname, 'public'),
  envDir: resolve(__dirname),
  resolve: {
    alias: {
      '@3dm': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
