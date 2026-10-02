import { Outlet, createRootRoute } from '@tanstack/react-router'
import { AccessGate } from '../components/AccessGate'
import { OutboxRunner } from '@household-brain/calendar/components/OutboxRunner'
import { SyncBar } from '@household-brain/calendar/components/SyncBar'
import { ReloadPrompt } from '../components/ReloadPrompt'

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <main className="mx-auto max-w-xl px-4 py-10">
        <AccessGate>
          <OutboxRunner />
          <div className="space-y-6">
            <SyncBar />
            <Outlet />
          </div>
        </AccessGate>
      </main>
      <ReloadPrompt />
    </div>
  ),
})
