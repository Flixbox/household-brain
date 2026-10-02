import type { ReactNode } from 'react'
import { AccessGate } from './AccessGate'
import { ReloadPrompt } from './ReloadPrompt'
import { SideDrawer } from './SideDrawer'
import { TopBar } from './TopBar'

/**
 * The frame around every feature: page layout, the sign-in gate, the update prompt, and for
 * signed-in people the top bar with its menu. `menu` is what the app puts in the menu above
 * "Sign out" (its links); the shell knows no features.
 */
export const AppShell = ({ children, menu }: { children: ReactNode, menu: ReactNode }) => (
  <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
    <main className="mx-auto max-w-xl px-4 py-10">
      <AccessGate>
        <TopBar />
        <SideDrawer>{menu}</SideDrawer>
        {children}
      </AccessGate>
    </main>
    <ReloadPrompt />
  </div>
)
