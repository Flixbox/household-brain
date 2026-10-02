import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { OutboxRunner } from '@household-brain/calendar/components/OutboxRunner'
import { SyncBar } from '@household-brain/calendar/components/SyncBar'
import { DoneToast } from '@household-brain/calendar/components/items/DoneToast'
import { AppShell } from '@household-brain/shell/components/AppShell'
import { closeMenu } from '@household-brain/shell/lib/menu'

const menuLink = 'block rounded-lg px-3 py-2 font-medium hover:bg-stone-100 dark:hover:bg-stone-800'

// The app's own entries in the shell's menu; following one closes the menu.
const menu = (
  <>
    <Link to="/" onClick={closeMenu} className={menuLink}>Entries</Link>
    <Link to="/settings" onClick={closeMenu} className={menuLink}>Settings</Link>
  </>
)

export const Route = createRootRoute({
  component: () => (
    <AppShell menu={menu}>
      <OutboxRunner />
      <div className="space-y-6">
        <SyncBar />
        <Outlet />
        <DoneToast />
      </div>
    </AppShell>
  ),
})
