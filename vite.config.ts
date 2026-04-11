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
      { find: /^igloo-ui$/, replacement: path.resolve(__dirname, '../igloo-ui/src/index.ts') },
      {
        find: /^igloo-ui\/styles\.css$/,
        replacement: path.resolve(__dirname, '../igloo-ui/dist/styles.css'),
      },
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
  },
  test: {
    include: ['test/frontend/**/*.test.ts', 'test/frontend/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  clearScreen: false,
}));
