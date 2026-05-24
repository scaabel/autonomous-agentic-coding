import type { APIRequestContext } from '@playwright/test'

// [PLACEHOLDER: update these endpoints and field names to match your API]
const REGISTER_ENDPOINT = '/api/v1/auth/register'
const DELETE_USER_ENDPOINT = (id: string) => `/api/v1/users/${id}`

export type TestUser = {
  id: string
  email: string
  password: string
}

/**
 * Creates a throwaway test user via the API.
 * Always call deleteTestUser in afterEach.
 */
export async function createTestUser(
  request: APIRequestContext,
  overrides: Partial<{ email: string; password: string }> = {}
): Promise<TestUser> {
  const email = overrides.email ?? `test+${Date.now()}@example.com`
  const password = overrides.password ?? 'Test1234!'

  const res = await request.post(REGISTER_ENDPOINT, {
    data: { email, password },
  })

  if (!res.ok()) {
    throw new Error(`Failed to create test user: ${res.status()} ${await res.text()}`)
  }

  const { data } = await res.json()
  return { id: data.id, email, password }
}

/**
 * Deletes a test user created by createTestUser.
 * Safe to call even if the user was already deleted.
 */
export async function deleteTestUser(
  request: APIRequestContext,
  id: string
): Promise<void> {
  await request.delete(DELETE_USER_ENDPOINT(id))
  // ignore errors — user may already be deleted
}
