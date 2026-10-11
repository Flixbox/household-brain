import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { revokeCalendarToken } from '@household-brain/entries/lib/google-token'
import { clearSearch } from '@household-brain/entries/lib/items/search'
import { onSignOut } from '@household-brain/shell/lib/session'
import { App } from './App'
import './index.css'

// The features, wired into the shell.
onSignOut(revokeCalendarToken)
onSignOut(clearSearch)

const root = document.querySelector('#root')
if (!root) {
  throw new Error('index.html has no #root element')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
