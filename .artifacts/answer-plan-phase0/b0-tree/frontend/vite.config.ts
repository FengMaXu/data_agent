import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron production builds load the renderer via file://,
// so packaged assets must use relative paths instead of /assets/...
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : './',
  plugins: [react()],
}))
