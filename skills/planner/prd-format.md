# PRD Format Requirements

A valid PRD must always contain ALL of the following. Incomplete plans will be rejected.

## Required sections

### 1. Summary
One clear paragraph describing what will be built, for whom, and why.

### 2. BE Steps
Every backend step must include:
- A unique id (be-001, be-002, ...)
- A precise description of the endpoint or logic to implement
- The exact file paths to create or modify
- Specific, testable acceptance criteria (not vague — "returns 200" not "works correctly")
- Files that must NOT be touched

### 3. FE Steps
Every frontend step must include:
- A unique id (fe-001, fe-002, ...)
- A precise description of the component or page to implement
- References to the exact API endpoints it will call (by path e.g. POST /api/v1/auth/login)
- The exact file paths to create or modify
- Specific, testable acceptance criteria
- A depends_on list referencing the BE step ids it needs

## Ordering rules
- BE steps that define an API endpoint must always come before FE steps that consume it
- Each step must be independently implementable and reviewable
- Steps should be small — if a step requires changing more than 3 files, split it

## Acceptance criteria rules
- Must be specific and verifiable by a code reviewer
- ✅ Good: "POST /api/v1/auth/login returns { data: { token: string } } on valid credentials"
- ❌ Bad: "Login works correctly"
- ✅ Good: "LoginForm renders an email input, password input, and submit button"
- ❌ Bad: "LoginForm looks good"

## Scope
- Only include what is explicitly asked for
- Do not add "nice to have" steps
- Out of scope items must not appear as steps
