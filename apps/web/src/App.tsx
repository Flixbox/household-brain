import { OutboxRunner } from '@household-brain/entries/components/OutboxRunner'
import { SyncBar } from '@household-brain/entries/components/SyncBar'
import { DoneToast } from '@household-brain/entries/components/items/DoneToast'
import { AppShell } from '@household-brain/shell/components/AppShell'
import { closeMenu } from '@household-brain/shell/lib/menu'
import { Link } from 'wouter'
import { paths } from '@household-brain/entries/lib/paths'
import { Pages } from './pages/Pages'

const menuLinkClass = 'block rounded-lg px-3 py-2 font-medium hover:bg-stone-100 dark:hover:bg-stone-800'

// The app's own entries in the shell's menu; following one closes the menu.
const menu = (
  <>
    <Link href={paths.home} onClick={closeMenu} className={menuLinkClass}>Entries</Link>
    <Link href={paths.settings} onClick={closeMenu} className={menuLinkClass}>Settings</Link>
    <Link href={paths.events} onClick={closeMenu} className={menuLinkClass}>Events</Link>
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
