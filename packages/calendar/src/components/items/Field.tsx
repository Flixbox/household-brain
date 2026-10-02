import type { ReactNode } from 'react'

/** A labelled form control. A required one gets a star; the control itself carries `required`. */
export const Field = ({ label, required = false, children }: { label: string, required?: boolean, children: ReactNode }) =>
  (
    <label className="grid gap-1">
      <span className="text-sm font-medium">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-pink-600 dark:text-pink-400">*</span>}
      </span>
      {children}
    </label>
  )
