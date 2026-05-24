# E2E Testing Conventions — Playwright

This skill applies whenever a task includes a `test_scope` field.
Every FE task that produces a user-visible page or flow MUST include a test file
in its `changes[]` output alongside the component code.

---

## Framework

- **Framework:** Playwright
- **Config:** `playwright.config.ts` at project root
- **Base URL:** `process.env.TEST_BASE_URL ?? 'http://localhost:3000'`
- **Test location:** `tests/e2e/[feature]/[name].e2e.ts`
- **Fixture directory:** `tests/e2e/fixtures/`
- **Setup file:** `tests/e2e/setup/auth.setup.ts`

---

## Selector strategy — `data-testid` ONLY

Never use CSS class names, element tags, or raw text content to find elements.
Always use `data-testid` attributes.

### Naming convention
```
[feature]-[element]-[variant?]
```

Examples:
```
data-testid="login-email-input"
data-testid="login-password-input"
data-testid="login-submit-button"
data-testid="login-error-message"
data-testid="register-form"
data-testid="register-confirm-password-input"
data-testid="dashboard-user-greeting"
data-testid="profile-save-button"
data-testid="billing-plan-card"
data-testid="crud-item-list"
data-testid="crud-item-delete-button"
data-testid="onboarding-step-indicator"
```

### Builder rule
Every component you build MUST include `data-testid` on:
- All form inputs
- All submit / action buttons
- All error message containers
- All loading state indicators
- All key content containers (lists, result areas, modals)
- Primary navigation links

A component without `data-testid` attributes will fail the Reviewer.

### Selector usage in tests
```ts
// ✅ correct
page.getByTestId('login-email-input')
page.getByTestId('login-submit-button')

// ❌ never use these
page.locator('.btn-primary')
page.locator('button[type="submit"]')
page.getByText('Submit')
```

---

## Test file structure

```ts
import { test, expect } from '@playwright/test'
import { loginAs } from '../fixtures/auth'      // for authenticated tests
import { createTestUser, deleteTestUser } from '../fixtures/users'

test.describe('[Feature Name]', () => {
  // Unauthenticated tests — no beforeEach needed
  // Authenticated tests — use storageState (see Auth section)

  test.beforeEach(async ({ page }) => {
    await page.goto('/route')
  })

  test('user can [action]', async ({ page }) => {
    // 1. Setup
    // 2. Action (fill, click, navigate)
    // 3. Assert outcome the user cares about
  })

  test.afterEach(async ({ request }) => {
    // cleanup test data if created
  })
})
```

---

## Auth state — Playwright storageState

Never log in manually inside each test. Use saved auth state via Playwright fixtures.

### Setup file: `tests/e2e/setup/auth.setup.ts`
```ts
import { test as setup } from '@playwright/test'

setup('authenticate', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email-input').fill(process.env.TEST_USER_EMAIL!)
  await page.getByTestId('login-password-input').fill(process.env.TEST_USER_PASSWORD!)
  await page.getByTestId('login-submit-button').click()
  await page.waitForURL('/dashboard')
  await page.context().storageState({ path: 'tests/e2e/fixtures/auth.json' })
})
```

### playwright.config.ts pattern
```ts
export default defineConfig({
  projects: [
    {
      name: 'setup',
      testMatch: '**/setup/*.setup.ts',
    },
    {
      name: 'authenticated',
      use: { storageState: 'tests/e2e/fixtures/auth.json' },
      dependencies: ['setup'],
    },
    {
      name: 'unauthenticated',
      // no storageState
    },
  ],
})
```

### Using auth in tests
```ts
// authenticated test — place in 'authenticated' project
test.use({ storageState: 'tests/e2e/fixtures/auth.json' })

test('authenticated user sees dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByTestId('dashboard-user-greeting')).toBeVisible()
})
```

### Environment variables required
```bash
# .env.test
TEST_BASE_URL=http://localhost:3000
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=Test1234!
```

These are never hardcoded in test files. Always read from `process.env`.

---

## Test data strategy — deterministic + afterEach cleanup

### Rules
- Never use production data or real user accounts
- Generate deterministic test identifiers using a prefix:
  ```ts
  const testId = `test-${Date.now()}`
  const testEmail = `test+${testId}@example.com`
  ```
- Always clean up created records in `afterEach`
- Never depend on test execution order — each test is fully independent

### Cleanup pattern
```ts
let createdUserId: string

test('user can register', async ({ page, request }) => {
  // test creates a user
  createdUserId = response.data.id
})

test.afterEach(async ({ request }) => {
  if (createdUserId) {
    await request.delete(`/api/v1/users/${createdUserId}`)
    createdUserId = ''
  }
})
```

### For tests that need existing data
Create a fixture helper, not inline setup:
```ts
// tests/e2e/fixtures/users.ts
export async function createTestUser(request: APIRequestContext) {
  const email = `test+${Date.now()}@example.com`
  const res = await request.post('/api/v1/auth/register', {
    data: { email, password: 'Test1234!' }
  })
  const { data } = await res.json()
  return { ...data, email, password: 'Test1234!' }
}

export async function deleteTestUser(request: APIRequestContext, id: string) {
  await request.delete(`/api/v1/users/${id}`)
}
```

---

## Assertion quality rules

### Be specific — assert what the user actually sees
```ts
// ❌ too shallow — only checks element exists
await expect(page.getByTestId('user-greeting')).toBeVisible()

// ✅ correct — checks actual content
await expect(page.getByTestId('user-greeting')).toContainText('Welcome')
```

### Assert the full user outcome, not intermediate steps
```ts
// ❌ asserts implementation detail
await expect(page.url()).toContain('/dashboard')

// ✅ asserts what the user experiences
await expect(page.getByTestId('dashboard-user-greeting')).toBeVisible()
await expect(page.getByTestId('dashboard-main-content')).toBeVisible()
```

### API response assertions (for contract integrity)
```ts
const response = await page.request.post('/api/v1/auth/login', {
  data: { email: 'test@example.com', password: 'Test1234!' }
})
await expect(response).toBeOK()
const body = await response.json()
expect(body).toMatchObject({
  data: {
    token: expect.any(String),
    user: {
      id: expect.any(String),
      email: 'test@example.com'
    }
  }
})
```

### Error state assertions
```ts
// Always assert both: the error is shown AND the user is still on the same page
await expect(page.getByTestId('login-error-message')).toBeVisible()
await expect(page.getByTestId('login-error-message')).toContainText('Invalid credentials')
await expect(page).toHaveURL('/login')
```

---

## Coverage requirements per flow type

### Auth flows
Every auth task MUST test:
- [ ] Happy path (valid input → success outcome)
- [ ] Invalid input (wrong credentials, weak password, duplicate email)
- [ ] Error message visibility and content
- [ ] Redirect after success
- [ ] Unauthenticated redirect for protected routes

### CRUD flows
Every CRUD task MUST test:
- [ ] Create: form submit → item appears in list
- [ ] Read: item data displayed correctly
- [ ] Update: change persists after page reload
- [ ] Delete: item removed from list, delete is confirmed
- [ ] Empty state: what the user sees with no data

### Onboarding flows
Every onboarding task MUST test:
- [ ] Each step renders and advances correctly
- [ ] Required fields block progression
- [ ] Completion redirects to expected destination
- [ ] Partially completed state is preserved on reload

### Payment / billing flows
Every billing task MUST test:
- [ ] Plan selection UI renders correctly
- [ ] Upgrade/downgrade flow initiates correctly
- [ ] Success state shows correct plan
- [ ] Error state handled gracefully (no silent failures)
- [ ] NOTE: Never test real payment processing — mock Stripe/payment provider

### API contract integrity
Every BE task MUST include an API test asserting:
- [ ] Response shape matches `docs/api-contract.json` exactly
- [ ] Required fields always present
- [ ] Error responses match contract on invalid input
- [ ] HTTP status codes match contract

### UI consistency (design system)
Every FE task MUST be reviewed for:
- [ ] No raw hex color values in component code
- [ ] No inline styles
- [ ] All interactive elements use design system components
- [ ] All spacing uses Tailwind scale (no arbitrary values)
- NOTE: These are caught by the Reviewer agent reading design-system.md,
        not by Playwright tests. Do not write Playwright tests for CSS values.

---

## Performance rules

- Each individual test must complete in under 15 seconds
- Do not add `page.waitForTimeout()` — use `waitForSelector` or `waitForURL` instead
- Parallelise where possible — tests must be independent enough to run in parallel

---

## What NOT to test

- CSS styling values (that's the design system reviewer's job)
- Internal implementation details (state shape, function calls)
- Third-party library behaviour (Stripe, Auth0, etc.) — mock these
- Animation timing
- Pixel-perfect layout
