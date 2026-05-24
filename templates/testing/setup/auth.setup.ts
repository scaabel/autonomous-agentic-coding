import { test as setup, expect } from '@playwright/test'
import path from 'path'

const authFile = path.join(__dirname, '../fixtures/auth.json')

setup('authenticate test user', async ({ page }) => {
  await page.goto('/login')   // [PLACEHOLDER: your login route]

  await page.getByTestId('login-email-input').fill(process.env.TEST_USER_EMAIL!)
  await page.getByTestId('login-password-input').fill(process.env.TEST_USER_PASSWORD!)
  await page.getByTestId('login-submit-button').click()

  // Wait for successful login
  await page.waitForURL('/dashboard')   // [PLACEHOLDER: your post-login route]
  await expect(page.getByTestId('dashboard-user-greeting')).toBeVisible()

  // Save auth state for reuse across all authenticated tests
  await page.context().storageState({ path: authFile })
})
