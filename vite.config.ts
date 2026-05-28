import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'esnext',
    minify: false,
    sourcemap: 'inline',
    rollupOptions: {
      output: { chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
})
