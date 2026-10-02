import type { ReactNode } from 'react'
import { AccessGate } from './AccessGate'
import { ReloadPrompt } from './ReloadPrompt'

/** The frame around every feature: page layout, the sign-in gate, and the update prompt. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <main className="mx-auto max-w-xl px-4 py-10">
        <AccessGate>{children}</AccessGate>
      </main>
      <ReloadPrompt />
    </div>
  )
}
