# Frontend Component Rules

## File structure
```
src/
  components/
    ui/          # shadcn primitives — never modify these
    [feature]/   # feature-specific components
  pages/ (or app/ for Next.js)
  hooks/         # custom React hooks
  lib/           # utilities, API client
  types/         # shared TypeScript types
```

## Component rules
- One component per file
- File name matches component name (PascalCase): `LoginForm.tsx`
- Always export as named export AND default export
- Always define prop types with TypeScript interfaces above the component

```tsx
// ✅ correct
interface LoginFormProps {
  onSuccess: (user: User) => void
  className?: string
}

export function LoginForm({ onSuccess, className }: LoginFormProps) { ... }
export default LoginForm
```

## API calls — always use the API client
Never use `fetch` directly in components. Always go through the API client:

```ts
// src/lib/api.ts — the central API client
import type { ApiResponse } from "@/types"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1"

export async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message ?? "Request failed")
  return json.data as T
}
```

## Form pattern — always use react-hook-form + zod

```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

type FormValues = z.infer<typeof schema>

export function LoginForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })
  ...
}
```

## Loading states
- Always show a `<Skeleton>` while data is loading
- Always show an error message if a request fails
- Disable submit buttons while `isSubmitting` is true
- Never leave the user staring at a blank screen

## Error handling in components
```tsx
const [error, setError] = useState<string | null>(null)

const onSubmit = async (data: FormValues) => {
  try {
    setError(null)
    await apiCall(...)
  } catch (err) {
    setError(err instanceof Error ? err.message : "Something went wrong")
  }
}
```

## Accessibility
- All form inputs must have `<label>` elements linked via `htmlFor`
- All buttons must have descriptive text (no icon-only buttons without `aria-label`)
- Use semantic HTML: `<main>`, `<nav>`, `<section>`, `<article>`, `<header>`, `<footer>`
