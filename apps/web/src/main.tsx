import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { forgetCalendarToken } from '@household-brain/calendar/lib/google-token'
import { onSignOut } from '@household-brain/shell/lib/session'
import './index.css'
import { routeTree } from './routeTree.gen'

// The features, wired into the shell.
onSignOut(forgetCalendarToken)

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const root = document.querySelector('#root')
if (!root) {
  throw new Error('index.html has no #root element')
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
