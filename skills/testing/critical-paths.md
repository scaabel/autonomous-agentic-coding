# Critical Paths — Regression Guardrails

These tests run after EVERY feature build, regardless of what was changed.
A failure in any critical path blocks the release unconditionally.
The agent never skips these. The agent never modifies these tests.

---

## What is a critical path

A critical path is a user flow where breakage means:
- The user cannot use the product at all, OR
- The user loses data or money, OR
- The user loses trust (silent wrong data, broken auth)

There are 6 categories. Each has a required test template below.
When you initialise a project, fill in the `[PLACEHOLDER]` values.
Add or remove individual tests within each category as your product grows —
but never remove an entire category once it has tests.

---

## CP-001 — Authentication: Register

**Protects:** New users can create accounts and reach the product.
**Blocks release if:** Registration is broken — zero new users can onboard.

```ts
// tests/e2e/critical-paths/cp-001-register.e2e.ts
import { test, expect } from '@playwright/test'
import { deleteTestUser } from '../fixtures/users'

test.describe('CP-001: User Registration', () => {
  let createdUserId: string

  test('new user can register and reach the dashboard', async ({ page, request }) => {
    const testEmail = `test+${Date.now()}@example.com`

    await page.goto('/register')                          // [PLACEHOLDER: your register route]
    await page.getByTestId('register-email-input').fill(testEmail)
    await page.getByTestId('register-password-input').fill('Test1234!')
    await page.getByTestId('register-confirm-password-input').fill('Test1234!')
    await page.getByTestId('register-submit-button').click()

    await page.waitForURL('/dashboard')                   // [PLACEHOLDER: your post-register redirect]
    await expect(page.getByTestId('dashboard-user-greeting')).toBeVisible()

    // capture id for cleanup
    const res = await request.get('/api/v1/auth/me')      // [PLACEHOLDER: your current user endpoint]
    const { data } = await res.json()
    createdUserId = data.id
  })

  test('duplicate email is rejected with clear error', async ({ page }) => {
    await page.goto('/register')
    await page.getByTestId('register-email-input').fill(process.env.TEST_USER_EMAIL!)
    await page.getByTestId('register-password-input').fill('Test1234!')
    await page.getByTestId('register-confirm-password-input').fill('Test1234!')
    await page.getByTestId('register-submit-button').click()

    await expect(page.getByTestId('register-error-message')).toBeVisible()
    await expect(page).toHaveURL('/register')
  })

  test('weak password is rejected before submission', async ({ page }) => {
    await page.goto('/register')
    await page.getByTestId('register-email-input').fill(`test+${Date.now()}@example.com`)
    await page.getByTestId('register-password-input').fill('123')
    await page.getByTestId('register-submit-button').click()

    await expect(page.getByTestId('register-password-error')).toBeVisible()
    await expect(page).toHaveURL('/register')
  })

  test.afterEach(async ({ request }) => {
    if (createdUserId) {
      await deleteTestUser(request, createdUserId)
      createdUserId = ''
    }
  })
})
```

---

## CP-002 — Authentication: Login & Logout

**Protects:** Existing users can access their account.
**Blocks release if:** Existing users are locked out.

```ts
// tests/e2e/critical-paths/cp-002-login.e2e.ts
import { test, expect } from '@playwright/test'

test.describe('CP-002: User Login & Logout', () => {
  test('registered user can log in and reach dashboard', async ({ page }) => {
    await page.goto('/login')                             // [PLACEHOLDER: your login route]
    await page.getByTestId('login-email-input').fill(process.env.TEST_USER_EMAIL!)
    await page.getByTestId('login-password-input').fill(process.env.TEST_USER_PASSWORD!)
    await page.getByTestId('login-submit-button').click()

    await page.waitForURL('/dashboard')                   // [PLACEHOLDER: post-login redirect]
    await expect(page.getByTestId('dashboard-user-greeting')).toBeVisible()
  })

  test('wrong password is rejected with clear error', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-email-input').fill(process.env.TEST_USER_EMAIL!)
    await page.getByTestId('login-password-input').fill('wrongpassword')
    await page.getByTestId('login-submit-button').click()

    await expect(page.getByTestId('login-error-message')).toBeVisible()
    await expect(page.getByTestId('login-error-message')).toContainText('Invalid') // [PLACEHOLDER: your error copy]
    await expect(page).toHaveURL('/login')
  })

  test('logged-in user can log out and is redirected', async ({ page }) => {
    // start authenticated
    test.use({ storageState: 'tests/e2e/fixtures/auth.json' })

    await page.goto('/dashboard')
    await page.getByTestId('logout-button').click()       // [PLACEHOLDER: your logout trigger]

    await page.waitForURL('/login')
    await expect(page.getByTestId('login-email-input')).toBeVisible()
  })
})
```

---

## CP-003 — Authentication: Route Protection

**Protects:** Private data cannot be accessed without authentication.
**Blocks release if:** Protected routes are publicly accessible — a security failure.

```ts
// tests/e2e/critical-paths/cp-003-route-protection.e2e.ts
import { test, expect } from '@playwright/test'

// These tests run WITHOUT storageState (unauthenticated)
test.describe('CP-003: Route Protection', () => {
  const protectedRoutes = [
    '/dashboard',         // [PLACEHOLDER: add all your protected routes]
    '/profile',
    '/billing',
    '/settings',
  ]

  for (const route of protectedRoutes) {
    test(`unauthenticated user cannot access ${route}`, async ({ page }) => {
      await page.goto(route)
      await page.waitForURL('/login')                     // [PLACEHOLDER: your auth redirect]
      await expect(page.getByTestId('login-email-input')).toBeVisible()
    })
  }
})
```

---

## CP-004 — API Contract Integrity

**Protects:** BE responses match the shape FE expects. Catches silent contract drift.
**Blocks release if:** Any endpoint returns a shape that would break the FE.

```ts
// tests/e2e/critical-paths/cp-004-api-contracts.e2e.ts
import { test, expect } from '@playwright/test'
import apiContract from '../../../docs/api-contract.json'  // reads live contract file

test.describe('CP-004: API Contract Integrity', () => {
  // Auth endpoints — always critical
  test('POST /api/v1/auth/login response matches contract', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: {
        email: process.env.TEST_USER_EMAIL!,
        password: process.env.TEST_USER_PASSWORD!
      }
    })
    await expect(res).toBeOK()
    const body = await res.json()
    expect(body).toMatchObject({
      data: {
        token: expect.any(String),
        user: {
          id: expect.any(String),
          email: expect.any(String)
        }
      }
    })
  })

  test('POST /api/v1/auth/login error response matches contract', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'nobody@example.com', password: 'wrongpassword' }
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({
      error: {
        code: expect.any(String),
        message: expect.any(String)
      }
    })
  })

  // [PLACEHOLDER: add a test block for each critical endpoint in your api-contract.json]
  // Pattern:
  // test('METHOD /api/v1/[route] response matches contract', async ({ request }) => { ... })
})
```

---

## CP-005 — Core CRUD Integrity

**Protects:** The primary data operations of your product work end to end.
**Blocks release if:** Users cannot create, view, update, or delete their core data.

```ts
// tests/e2e/critical-paths/cp-005-core-crud.e2e.ts
import { test, expect } from '@playwright/test'

// [PLACEHOLDER: replace 'item' with your primary resource — post, project, invoice, etc.]
test.describe('CP-005: Core CRUD — [Resource Name]', () => {
  test.use({ storageState: 'tests/e2e/fixtures/auth.json' })

  let createdItemId: string

  test('user can create a [resource]', async ({ page }) => {
    await page.goto('/[resource-list-route]')             // [PLACEHOLDER]
    await page.getByTestId('[resource]-create-button').click()

    await page.getByTestId('[resource]-name-input').fill('Test Item')
    // [PLACEHOLDER: fill other required fields]
    await page.getByTestId('[resource]-save-button').click()

    await expect(page.getByTestId('[resource]-item-list')).toContainText('Test Item')
  })

  test('user can view a [resource]', async ({ page }) => {
    await page.goto('/[resource-list-route]')
    await page.getByTestId('[resource]-item-link').first().click()

    await expect(page.getByTestId('[resource]-detail-title')).toBeVisible()
  })

  test('user can update a [resource]', async ({ page }) => {
    await page.goto('/[resource-detail-route]')           // [PLACEHOLDER]
    await page.getByTestId('[resource]-edit-button').click()
    await page.getByTestId('[resource]-name-input').fill('Updated Name')
    await page.getByTestId('[resource]-save-button').click()

    await expect(page.getByTestId('[resource]-detail-title')).toContainText('Updated Name')
  })

  test('user can delete a [resource]', async ({ page }) => {
    await page.goto('/[resource-list-route]')
    const initialCount = await page.getByTestId('[resource]-list-item').count()

    await page.getByTestId('[resource]-delete-button').first().click()
    await page.getByTestId('[resource]-delete-confirm-button').click()   // [PLACEHOLDER: if you have a confirm step]

    await expect(page.getByTestId('[resource]-list-item')).toHaveCount(initialCount - 1)
  })
})
```

---

## CP-006 — User Onboarding

**Protects:** New users can complete setup and reach a usable product state.
**Blocks release if:** New users get stuck and cannot use the product.

```ts
// tests/e2e/critical-paths/cp-006-onboarding.e2e.ts
import { test, expect } from '@playwright/test'
import { createTestUser, deleteTestUser } from '../fixtures/users'

test.describe('CP-006: User Onboarding', () => {
  // [PLACEHOLDER: fill in your onboarding flow steps]
  // This template assumes a multi-step onboarding wizard.
  // If your onboarding is a single page, simplify accordingly.

  test('new user completes onboarding and reaches product', async ({ page, request }) => {
    const { id, email, password } = await createTestUser(request)

    // Log in as new user (who hasn't completed onboarding)
    await page.goto('/login')
    await page.getByTestId('login-email-input').fill(email)
    await page.getByTestId('login-password-input').fill(password)
    await page.getByTestId('login-submit-button').click()

    // Should be redirected to onboarding
    await page.waitForURL('/onboarding')                  // [PLACEHOLDER]

    // Step 1                                             // [PLACEHOLDER: your step 1 fields]
    await page.getByTestId('onboarding-step-1-next').click()
    await expect(page.getByTestId('onboarding-step-indicator')).toContainText('2')

    // Step 2                                             // [PLACEHOLDER: your step 2 fields]
    await page.getByTestId('onboarding-step-2-next').click()

    // Completion
    await page.waitForURL('/dashboard')                   // [PLACEHOLDER: post-onboarding destination]
    await expect(page.getByTestId('dashboard-user-greeting')).toBeVisible()

    await deleteTestUser(request, id)
  })

  test('onboarding progress is preserved on reload', async ({ page, request }) => {
    const { id, email, password } = await createTestUser(request)

    await page.goto('/login')
    await page.getByTestId('login-email-input').fill(email)
    await page.getByTestId('login-password-input').fill(password)
    await page.getByTestId('login-submit-button').click()
    await page.waitForURL('/onboarding')

    // Complete step 1
    // [PLACEHOLDER: fill step 1]
    await page.getByTestId('onboarding-step-1-next').click()

    // Reload
    await page.reload()

    // Should still be on step 2, not reset to step 1
    await expect(page.getByTestId('onboarding-step-indicator')).toContainText('2')

    await deleteTestUser(request, id)
  })
})
```

---

## CP-007 — Payments / Billing

**Protects:** Users can manage their subscription without errors or data loss.
**Blocks release if:** Billing UI is broken — users cannot upgrade, downgrade, or view their plan.

> ⚠️ IMPORTANT: Never test real payment processing. Always mock the payment provider
> (Stripe, Paddle, etc.) using their official test mode or a mock server.
> Never use real card numbers even in test environments.

```ts
// tests/e2e/critical-paths/cp-007-billing.e2e.ts
import { test, expect } from '@playwright/test'

test.describe('CP-007: Billing & Payments', () => {
  test.use({ storageState: 'tests/e2e/fixtures/auth.json' })

  test('user can view their current plan', async ({ page }) => {
    await page.goto('/billing')                           // [PLACEHOLDER]
    await expect(page.getByTestId('billing-current-plan')).toBeVisible()
    await expect(page.getByTestId('billing-current-plan')).not.toBeEmpty()
  })

  test('plan selection UI renders all available plans', async ({ page }) => {
    await page.goto('/billing')
    const planCards = page.getByTestId('billing-plan-card')
    await expect(planCards).toHaveCount(/* [PLACEHOLDER: number of plans] */ 3)
  })

  test('upgrade flow initiates without error', async ({ page }) => {
    await page.goto('/billing')
    await page.getByTestId('billing-upgrade-button').click()

    // Should reach payment step or redirect to payment provider
    // Do NOT assert payment completion — mock that separately
    await expect(page.getByTestId('billing-payment-step')).toBeVisible() // [PLACEHOLDER]
  })

  test('billing error is handled gracefully', async ({ page }) => {
    // [PLACEHOLDER: trigger a billing error using your mock/test mode]
    // Assert: user sees an error message, not a blank screen or unhandled exception
    await expect(page.getByTestId('billing-error-message')).toBeVisible()
    await expect(page.getByTestId('billing-error-message')).not.toBeEmpty()
  })
})
```

---

## Running critical paths

```bash
# Run only critical paths (fast — run before every commit)
npx playwright test tests/e2e/critical-paths/

# Run full suite including feature tests
npx playwright test

# Run a specific critical path
npx playwright test tests/e2e/critical-paths/cp-001-register.e2e.ts
```

---

## Rules for the agent

1. **Never modify critical path test files.** They are read-only from the agent's perspective.
   If a feature requires a change to a critical path test, that change must be reviewed by a human.

2. **Never skip critical paths** due to unrelated feature scope.
   A billing feature still runs CP-001 through CP-004.

3. **If a critical path fails after your changes**, that is a regression you caused.
   The Orchestrator will identify which task caused it and retry that task with the regression
   context injected into the builder prompt.

4. **When building a feature that matches a critical path category**, your feature test must
   cover the same flows as the critical path — but scoped to the new feature specifically.
   Do not duplicate the critical path test. Write a separate feature test.

---

## Placeholder checklist — fill these in before first run

When you initialise a new project, search for `[PLACEHOLDER]` in this file and fill in:

- [ ] Your register route (`/register`, `/signup`, etc.)
- [ ] Your login route (`/login`, `/auth`, etc.)
- [ ] Your post-login redirect (`/dashboard`, `/app`, etc.)
- [ ] Your post-register redirect
- [ ] Your auth redirect for protected routes
- [ ] Your logout trigger (button testid)
- [ ] Your primary protected routes list (CP-003)
- [ ] Your critical API endpoints (CP-004)
- [ ] Your primary resource name and routes (CP-005)
- [ ] Your onboarding flow steps (CP-006)
- [ ] Your billing routes and plan count (CP-007)
- [ ] `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` in `.env.test`
