import { type Page, expect } from '@playwright/test'
import { allowlist } from './emulators'

declare global {
  interface Window {
    e2eSignIn: (email: string) => Promise<unknown>
  }
}

/** Signs in through the emulator-only hook, without the Google popup. */
export const signInAs = (page: Page, email: string) => page.evaluate(address => window.e2eSignIn(address), email)

/** Signs in, reads the user id from the no-access screen, allowlists it, and waits until access is granted. */
export async function signInAllowlisted(page: Page, email: string): Promise<string> {
  await page.goto('/')
  await signInAs(page, email)
  const uid = await page.getByTestId('uid').textContent()
  if (!uid) {
    throw new Error('The no-access screen showed no user id')
  }
  await allowlist(uid)
  await expect(page.getByText("You're on the allowlist.")).toBeVisible()
  return uid
}
