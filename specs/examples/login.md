# Example: How to write a manual spec

Instead of using `agent run "..."` you can write specs manually
and pass the spec file path. This gives you tighter control.

Run with:
```bash
npm run dev -- run "$(cat specs/examples/login.md)"
```

Or just use the natural language form — the Planner will produce
something similar to this automatically, which you can then edit.

---

# PRD — User Authentication (Login + Register)

## Summary
Add email/password authentication to the app. Users can register with an email
and password, log in to receive a JWT, and access protected routes. The FE will
have a login page and a register page that call the BE endpoints.

## BE Steps

### be-001 — POST /api/v1/auth/register

Create a registration endpoint that accepts email + password, hashes the
password, and creates a new user record.

**Acceptance criteria:**
- [ ] POST /api/v1/auth/register accepts { email: string, password: string }
- [ ] Returns 201 with { data: { id, email } } on success
- [ ] Returns 400 with field errors if email is invalid or password < 8 chars
- [ ] Returns 409 if email already exists
- [ ] Password is hashed with bcrypt before storing

**Files to touch:** `src/routes/auth.ts`, `src/models/user.ts`
**Do not modify:** `src/middleware/`, `src/db/migrations/`

---

### be-002 — POST /api/v1/auth/login

Create a login endpoint that validates credentials and returns a JWT.

**Acceptance criteria:**
- [ ] POST /api/v1/auth/login accepts { email: string, password: string }
- [ ] Returns 200 with { data: { token: string, user: { id, email } } } on success
- [ ] Returns 401 with UNAUTHORIZED if credentials are invalid
- [ ] JWT expires in 7 days
- [ ] Token is signed with JWT_SECRET from environment

**Files to touch:** `src/routes/auth.ts`
**Do not modify:** `src/models/user.ts`
**Depends on:** be-001

## FE Steps

### fe-001 — LoginPage and LoginForm

Create a login page at /login with a form for email and password.

**Acceptance criteria:**
- [ ] Page renders at /login
- [ ] Form has email input, password input, and submit button
- [ ] Calls POST /api/v1/auth/login on submit
- [ ] Shows loading state while request is in-flight
- [ ] Shows error message from API on failure
- [ ] Redirects to /dashboard on success
- [ ] Follows design system — uses design tokens for all colors

**Files to touch:** `src/pages/login.tsx`, `src/components/auth/LoginForm.tsx`
**Depends on:** be-002

---

### fe-002 — RegisterPage and RegisterForm

Create a register page at /register with a form for email and password.

**Acceptance criteria:**
- [ ] Page renders at /register
- [ ] Form has email input, password input, confirm password input, and submit button
- [ ] Validates that password and confirm password match before submitting
- [ ] Calls POST /api/v1/auth/register on submit
- [ ] Shows loading state while request is in-flight
- [ ] Shows error message from API on failure (including field-level errors)
- [ ] Redirects to /login on success with a success toast
- [ ] Follows design system — uses design tokens for all colors

**Files to touch:** `src/pages/register.tsx`, `src/components/auth/RegisterForm.tsx`
**Depends on:** be-001
