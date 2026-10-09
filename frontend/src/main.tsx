import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are self-hosted (fontsource); Google Fonts is often unreachable from mainland China.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/josefin-sans'
import './index.css'
import Root from './Root.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
