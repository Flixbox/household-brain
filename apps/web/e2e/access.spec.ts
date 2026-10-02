import { expect, test } from '@playwright/test'
import { allowlist, resetEmulators } from './emulators'
import { openMenu, signInAs } from './session'

test.beforeEach(async () => {
  await resetEmulators()
})

test('getting in: signed out, turned away without the allowlist, let in with it, and out again', async ({ page }) => {
  await page.goto('/')

  await test.step('a signed-out visitor only sees the sign-in button', async () => {
    await expect(page.getByRole('heading', { name: 'Household Brain' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  })

  await test.step('the sign-in button opens the Google sign-in popup', async () => {
    const popup = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Sign in with Google' }).click()
    const signInWindow = await popup
    await expect(signInWindow).toHaveURL(/\/emulator\/auth\/handler.*providerId=google\.com/u)
    await signInWindow.close()
  })

  await test.step('an account that is not on the allowlist is turned away and shown its user id', async () => {
    await signInAs(page, 'stranger@household-brain.test')
    await expect(page.getByText('This account has no access.')).toBeVisible()
    await expect(page.getByTestId('uid')).not.toBeEmpty()
    await expect(page.getByText("You're on the allowlist")).toHaveCount(0)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  })

  await test.step('an allowlisted account gets in, and can sign out again', async () => {
    await signInAs(page, 'owner@household-brain.test')
    const uid = await page.getByTestId('uid').textContent()
    if (!uid) {
      throw new Error('The no-access screen showed no user id')
    }
    await allowlist(uid)
    await page.reload()
    await expect(page.getByText("Hello, owner. You're on the allowlist.")).toBeVisible()

    // The menu opens from the top bar and closes with Escape; "Sign out" lives in it.
    const menu = page.getByRole('dialog', { name: 'Menu' })
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden()
    await openMenu(page)
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(page.getByRole('button', { exact: true, name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
    await openMenu(page)
    await menu.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  })
})
