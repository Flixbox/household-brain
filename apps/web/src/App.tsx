import { OutboxRunner } from '@household-brain/entries/components/OutboxRunner'
import { SyncBar } from '@household-brain/entries/components/SyncBar'
import { DoneToast } from '@household-brain/entries/components/items/DoneToast'
import { AppShell } from '@household-brain/shell/components/AppShell'
import { closeMenu } from '@household-brain/shell/lib/menu'
import { Link } from 'wouter'
import { Pages } from './pages/Pages'

const menuLink = 'block rounded-lg px-3 py-2 font-medium hover:bg-stone-100 dark:hover:bg-stone-800'

// The app's own entries in the shell's menu; following one closes the menu.
const menu = (
  <>
    <Link href="/" onClick={closeMenu} className={menuLink}>Entries</Link>
    <Link href="/settings" onClick={closeMenu} className={menuLink}>Settings</Link>
    <Link href="/events" onClick={closeMenu} className={menuLink}>Events</Link>
  </>
)

// Named, so React Compiler recognises it as a component.
export const App = () => (
  <AppShell menu={menu}>
    <OutboxRunner />
    <div className="space-y-6">
      <SyncBar />
      <Pages />
      <DoneToast />
    </div>
  </AppShell>
)
