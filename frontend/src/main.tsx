import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.tsx'
import { initTheme } from './services/theme'

// Redundant with index.html's inline bootstrap script in the normal case
// (that one already ran, before any paint) — this is the fallback for the
// unlikely event data-theme never got set (e.g. that script failed).
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
