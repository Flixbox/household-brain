import { type Locator, type Page, expect } from '@playwright/test'
import { allowlist } from './emulators'

declare global {
  interface Window {
    e2eSignIn: (email: string) => Promise<unknown>
  }
}

/** Opens the app menu (the drawer behind the top bar's button). */
export const openMenu = (page: Page) => page.getByRole('button', { exact: true, name: 'Menu' }).click()

/**
 * Clicks a "Sign out" button and waits until the app has deleted its offline data and reloaded
 * (#114), so the next step doesn't run into the reload.
 */
export const signOutWith = async (page: Page, button: Locator) => {
  await Promise.all([page.waitForEvent('load'), button.click()])
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
}

/** Signs in through the emulator-only hook, without the Google popup. */
export const signInAs = (page: Page, email: string) => page.evaluate(address => window.e2eSignIn(address), email)

/** Signs in, reads the user id from the no-access screen, allowlists it, and waits until access is granted. */
export const signInAllowlisted = async (page: Page, email: string): Promise<string> => {
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
