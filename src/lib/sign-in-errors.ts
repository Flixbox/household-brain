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
      return 'New accounts are switched off in Firebase Authentication. Turn "Enable create (sign-up)" '
        + 'back on under Settings → User actions; the allowlist decides who gets in.'
    }
    case 'auth/unauthorized-domain': {
      return 'This address is not an authorised sign-in domain for the Firebase project.'
    }
    default: {
      return error instanceof Error ? error.message : String(error)
    }
  }
}
