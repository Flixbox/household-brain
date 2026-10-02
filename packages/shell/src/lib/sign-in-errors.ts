/**
 * Turns a failed Google sign-in into something the person can act on. Returns null when nothing
 * should be shown (the person closed the popup themselves).
 */
export function signInErrorMessage(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': {
      return null
    }
    case 'auth/popup-blocked': {
      return 'The sign-in window was blocked. Allow pop-ups for this site and try again.'
    }
    case 'auth/admin-restricted-operation': {
      return 'Sign-up is switched off for this app, so no new account can sign in. Ask the owner to turn on '
        + '"Enable create (sign-up)" in Firebase Authentication (Settings → User actions).'
    }
    case 'auth/unauthorized-domain': {
      return 'This address is not an authorised sign-in domain for the Firebase project.'
    }
    default: {
      return error instanceof Error ? error.message : String(error)
    }
  }
}
