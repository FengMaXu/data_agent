import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// Electron production builds load the renderer via file://,
// so packaged assets must use relative paths instead of /assets/...
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : './',
  plugins: [react()],
  // The landing page's download panel shows the desktop version it links to.
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
}))
