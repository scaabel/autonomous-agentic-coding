# BE API Conventions

## Response envelope — always use this exact shape

Success:
```json
{ "data": <payload>, "meta": {} }
```

Error:
```json
{ "error": { "code": "ERROR_CODE", "message": "Human readable message" } }
```

## HTTP Status Codes
- 200: success (GET, PUT, PATCH)
- 201: created (POST)
- 400: validation error
- 401: unauthenticated (missing/invalid token)
- 403: unauthorized (valid token, wrong permissions)
- 404: not found
- 409: conflict (duplicate resource)
- 500: internal server error

## Route naming
- kebab-case paths: `/api/v1/user-profiles` not `/api/v1/userProfiles`
- Always versioned: `/api/v1/...`
- Resource names plural: `/api/v1/users` not `/api/v1/user`
- Actions as sub-resources: `/api/v1/users/:id/deactivate`

## Validation
- Always validate request bodies with zod before processing
- Return 400 with field-level error details on validation failure
- Never trust client input — validate types, ranges, and formats

## Error codes (use these exact strings)
- `VALIDATION_ERROR`
- `NOT_FOUND`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `CONFLICT`
- `INTERNAL_ERROR`

## TypeScript patterns
- Always type request/response shapes with zod schemas
- Use async/await, never raw promises
- Always handle errors with try/catch and return proper error responses
- Never use `any` — use `unknown` and narrow with guards
