# Frontend Design System

CRITICAL: These rules are non-negotiable. Every UI change must follow them exactly.
The Reviewer will fail your output if any of these rules are violated.

---

## Colors — use ONLY these values

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#1a1a2e` | Primary brand, headers |
| `--color-secondary` | `#16213e` | Secondary surfaces |
| `--color-accent` | `#e94560` | CTAs, highlights, active states |
| `--color-bg` | `#0f0f0f` | Page background |
| `--color-surface` | `#1a1a1a` | Card/panel backgrounds |
| `--color-border` | `#2a2a2a` | Borders, dividers |
| `--color-text` | `#f5f5f5` | Primary text |
| `--color-text-muted` | `#a0a0a0` | Secondary text, captions |
| `--color-success` | `#22c55e` | Success states |
| `--color-warning` | `#f59e0b` | Warning states |
| `--color-error` | `#ef4444` | Error states |

**Never use raw hex values in components.** Always use CSS variables or Tailwind tokens.

---

## Typography

- **Display/Heading font:** `'DM Sans', sans-serif` (import from Google Fonts)
- **Body font:** `'DM Sans', sans-serif`
- **Mono font:** `'JetBrains Mono', monospace` (for code, IDs, timestamps)

### Scale (Tailwind)
| Usage | Class |
|-------|-------|
| Page title | `text-4xl font-bold` |
| Section heading | `text-2xl font-semibold` |
| Card title | `text-lg font-medium` |
| Body | `text-base` |
| Caption/label | `text-sm text-[--color-text-muted]` |
| Micro | `text-xs` |

---

## Spacing
- Use Tailwind spacing scale only (multiples of 4px)
- Standard padding: `p-4` (16px) for cards, `p-6` (24px) for page sections
- Standard gap: `gap-4` between related items, `gap-6` between sections
- **Never use arbitrary values** like `p-[13px]`, `mt-[7px]`, etc.

---

## Components — use these, never reinvent

| Need | Use |
|------|-----|
| Button | `<Button>` from `@/components/ui/button` |
| Input | `<Input>` from `@/components/ui/input` |
| Form | `react-hook-form` + zod resolver |
| Loading | `<Skeleton>` from `@/components/ui/skeleton` |
| Toast/notification | `<toast>` from `@/components/ui/toast` |
| Modal | `<Dialog>` from `@/components/ui/dialog` |
| Select | `<Select>` from `@/components/ui/select` |

**Never import from external component libraries not already in the project.**

---

## Tailwind conventions
- Dark mode is default (no `dark:` prefix needed — design is dark-first)
- Use `rounded-lg` for cards, `rounded-md` for inputs/buttons, `rounded-full` for badges
- Use `shadow-lg` for elevated surfaces
- Transitions: always `transition-colors duration-200` on interactive elements
- Focus rings: `focus:outline-none focus:ring-2 focus:ring-[--color-accent]`

---

## DO NOT
- Use inline styles (`style={{ color: '#fff' }}`)
- Use arbitrary Tailwind values (`text-[#abc123]`, `w-[327px]`)
- Use `!important`
- Mix Tailwind with raw CSS for the same property
- Use emojis in production UI (only in dev tools/CLI)
- Use `opacity-50` on text — use `text-[--color-text-muted]` instead
