import { test, expect } from '@playwright/test'

// These tests mock the auth session and API responses to avoid real Gmail
// Set up: mock /api/auth/session to return a valid session,
// and mock /api/senders and /api/sync/status

test.beforeEach(async ({ page, context }) => {
  // Set E2E bypass cookie so the server-side auth() check is skipped
  await context.addCookies([
    { name: 'e2e-bypass', value: '1', domain: 'localhost', path: '/' },
  ])

  // Mock NextAuth session
  await page.route('**/api/auth/session', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'test-user', email: 'test@example.com', name: 'Test User' },
        expires: '2099-01-01',
      }),
    })
  )

  // Mock sync status — idle
  await page.route('**/api/sync/status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'idle',
        progress: 0,
        totalEmails: null,
        processedEmails: 0,
        errorMessage: null,
      }),
    })
  )

  // Mock sender list
  await page.route('**/api/senders**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 2,
        senders: [
          {
            id: 'sender-1',
            userId: 'test-user',
            senderEmail: 'news@example.com',
            senderName: 'Example Newsletter',
            emailCount: 142,
            latestEmailDate: '2026-07-01T00:00:00Z',
            hasUnsubscribeLink: true,
            unsubscribeUrl: 'https://example.com/unsub',
            unsubscribeEmail: null,
            status: 'active',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-07-01T00:00:00Z',
          },
          {
            id: 'sender-2',
            userId: 'test-user',
            senderEmail: 'promo@store.com',
            senderName: 'Store Promos',
            emailCount: 87,
            latestEmailDate: '2026-06-15T00:00:00Z',
            hasUnsubscribeLink: false,
            unsubscribeUrl: null,
            unsubscribeEmail: null,
            status: 'active',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-06-15T00:00:00Z',
          },
        ],
      }),
    })
  )
})

test('dashboard shows sender list', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByText('Example Newsletter')).toBeVisible()
  await expect(page.getByText('Store Promos')).toBeVisible()
})

test('unsubscribe button only shown for senders with link', async ({ page }) => {
  await page.goto('/dashboard')
  const rows = page.locator('[data-testid="sender-row"]')
  // sender-1 has unsubscribe link
  await expect(rows.first().getByRole('button', { name: /unsubscribe/i })).toBeVisible()
  // sender-2 has no unsubscribe link
  await expect(rows.nth(1).getByRole('button', { name: /unsubscribe/i })).not.toBeVisible()
})

test('unsubscribe modal opens and shows delete option', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /unsubscribe/i }).first().click()
  await expect(page.getByText('Unsubscribe from Example Newsletter')).toBeVisible()
  await expect(page.getByText(/also delete 142 existing emails/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /open unsubscribe page/i })).toBeVisible()
})

test('bulk action bar appears when sender selected', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('checkbox').first().check()
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect(page.getByRole('button', { name: /delete all/i }).first()).toBeVisible()
})

test('delete confirm modal appears on delete', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /delete all/i }).first().click()
  await expect(page.getByText(/delete all emails\?/i)).toBeVisible()
  await expect(page.getByText(/this cannot be undone/i)).toBeVisible()
})
