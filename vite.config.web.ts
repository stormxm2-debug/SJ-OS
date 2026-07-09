import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Emits `version.json` with a unique id per build. The running app polls this file
 * (src/renderer/src/services/system/appUpdate.ts) and reloads itself when a new
 * deploy lands — this is how phones auto-update without a service worker.
 */
function buildVersionPlugin(): Plugin {
  return {
    name: 'sj-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: `${Date.now()}`, builtAt: new Date().toISOString() })
      })
    }
  }
}

/**
 * Standalone WEB build config for the SJ OS mobile PWA / staff web app.
 *
 * This is SEPARATE from electron.vite.config.ts — the Electron desktop build is
 * unchanged (`npm run dev` / `npm run build` still use electron-vite). This config
 * builds ONLY the renderer (src/renderer) into `dist/` for static hosting (Netlify).
 * No secrets here; Supabase URL/anon key come from Netlify env at build time
 * (import.meta.env). The renderer guards window.sj access so it runs without Electron.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: '/',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react(), buildVersionPlugin()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
