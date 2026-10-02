import { Outlet, createRootRoute } from '@tanstack/react-router'
import { OutboxRunner } from '@household-brain/calendar/components/OutboxRunner'
import { SyncBar } from '@household-brain/calendar/components/SyncBar'
import { AppShell } from '@household-brain/shell/components/AppShell'

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <OutboxRunner />
      <div className="space-y-6">
        <SyncBar />
        <Outlet />
      </div>
    </AppShell>
  ),
})
