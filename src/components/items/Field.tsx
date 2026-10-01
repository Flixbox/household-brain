import type { ReactNode } from 'react'

/** A labelled form control. */
export function Field({ label, children }: { label: string, children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
