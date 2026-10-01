import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ReloadPrompt } from '../components/ReloadPrompt'

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <main className="mx-auto max-w-xl px-4 py-10">
        <Outlet />
      </main>
      <ReloadPrompt />
    </div>
  ),
})
