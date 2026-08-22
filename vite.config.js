import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const appMode = process.env.VITE_APP_MODE ?? 'demo';

if (!['demo', 'production'].includes(appMode)) {
  throw new Error(`ENV_CONFIG_INVALID: unsupported VITE_APP_MODE "${appMode}"`);
}

const adapterPath = appMode === 'demo'
  ? './src/demo/adapter.js'
  : './src/production/adapter.js';
const modePresentationPath = appMode === 'demo'
  ? './src/demo/mode-presentation.js'
  : './src/production/mode-presentation.js';

export default defineConfig({
  resolve: {
    alias: {
      '#runtime-adapter': fileURLToPath(new URL(adapterPath, import.meta.url)),
      '#mode-presentation': fileURLToPath(new URL(modePresentationPath, import.meta.url))
    }
  },
  define: {
    __APP_MODE__: JSON.stringify(appMode)
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@supabase')) return 'supabase';
          return undefined;
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html']
    }
  }
});
