import { useStore } from '@nanostores/react'
import { $user } from '@household-brain/firebase/user'

/** Greets the signed-in account, which AccessGate let in, so it is on the allowlist. */
export const Greeting = () => {
  const user = useStore($user)
  return (
    <p className="text-lg">
      Hello,
      {' '}
      {user?.displayName ?? user?.email}
      . You&apos;re on the allowlist.
    </p>
  )
}
