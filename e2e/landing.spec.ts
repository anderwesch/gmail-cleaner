import { test, expect } from '@playwright/test'

test('landing page shows sign-in button', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Gmail Cleanup' })).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible()
})

test('unauthenticated user is redirected from /dashboard to /', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL('/')
})
