import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { resetDemoDataOnce } from './services/system/resetDemoData'
import { startAppUpdateWatcher } from './services/system/appUpdate'

// Clear seeded practice data once, before first render, so a real employee starts clean.
resetDemoDataOnce()

// Web/PWA: reload once when a newer deploy is detected (no-op in dev/Electron).
startAppUpdateWatcher()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
