import { type Page, expect, test } from '@playwright/test'
import { allowlist, resetEmulators } from './emulators'

declare global {
  interface Window {
    e2eSignIn: (email: string) => Promise<unknown>
  }
}

const signInAs = (page: Page, email: string) => page.evaluate(address => window.e2eSignIn(address), email)

test.beforeEach(async () => {
  await resetEmulators()
})

test('a signed-out visitor only sees the sign-in button', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Household Brain' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
})

test('the sign-in button opens the Google sign-in popup', async ({ page }) => {
  await page.goto('/')
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  await expect((await popup)).toHaveURL(/\/emulator\/auth\/handler.*providerId=google\.com/u)
})

test('an account that is not on the allowlist is turned away and shown its user id', async ({ page }) => {
  await page.goto('/')
  await signInAs(page, 'stranger@example.com')
  await expect(page.getByText('This account has no access.')).toBeVisible()
  await expect(page.getByTestId('uid')).not.toBeEmpty()
  await expect(page.getByText("You're on the allowlist")).toHaveCount(0)
})

test('an allowlisted account gets in, and can sign out again', async ({ page }) => {
  await page.goto('/')
  await signInAs(page, 'owner@example.com')
  const uid = await page.getByTestId('uid').textContent()
  if (!uid) {
    throw new Error('The no-access screen showed no user id')
  }

  await allowlist(uid)
  await page.reload()
  await expect(page.getByText("Hello, owner. You're on the allowlist.")).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
})
