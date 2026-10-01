import { type FormEvent, useState } from 'react'
import { shareHousehold } from '../../lib/calendar/connect'
import type { HouseholdConfig } from '../../lib/calendar/setup'
import { useTask } from '../../lib/use-task'
import { StatusLine } from './StatusLine'
import { primaryButton, textField } from './styles'

export function ShareSection({ config }: { config: HouseholdConfig }) {
  const { busy, run, status } = useTask()
  const [email, setEmail] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    return run(() => shareHousehold(config, email.trim()))
  }
  return (
    <form className="space-y-3" onSubmit={submit}>
      <h2 className="text-xl font-semibold">Share with</h2>
      <p>Gives another Google account permission to change events in the household calendar.</p>
      <div className="flex flex-wrap gap-3">
        <input
          type="email"
          required
          aria-label="Google account email"
          placeholder="name@gmail.com"
          className={textField}
          value={email}
          onChange={event => setEmail(event.target.value)}
        />
        <button type="submit" className={primaryButton} disabled={busy}>Share</button>
      </div>
      <StatusLine status={status} />
    </form>
  )
}
