import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: /^igloo-shared$/, replacement: path.resolve(__dirname, '../igloo-shared/src/index.ts') },
      { find: /^igloo-ui$/, replacement: path.resolve(__dirname, '../igloo-ui/src/index.ts') },
      { find: /^react$/, replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
    fs: {
      // igloo-shared / igloo-ui resolve to sibling-submodule sources outside this
      // project root. Vite's workspace-root auto-detection stops at the first `.git`
      // it finds, and `repos/igloo-home/.git` is a submodule gitdir *file*, so it
      // pins the allow list to repos/igloo-home and blocks sibling sources.
      // Allow the monorepo root so shared submodule sources — including igloo-ui
      // source CSS and its vendored fonts — are served.
      allow: [path.resolve(__dirname, '../..')]
    },
  },
  test: {
    include: ['test/frontend/**/*.test.ts', 'test/frontend/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  clearScreen: false,
}));
