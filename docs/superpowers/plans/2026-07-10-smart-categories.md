# Smart Categories & Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add smart inbox categories, inbox/archived split, and a Quick Wins suggestions card to the Gmail Cleanup dashboard.

**Architecture:** New `SenderCategory` enum and two new fields (`category`, `inboxCount`, `archivedCount`) on `SenderGroup`. Classification runs as a post-pass inside the existing `full-sync` worker job: domain rules first, then Gmail query probes for uncategorized senders, then per-sender inbox/archived counts. Dashboard gains category tabs, inbox/archived tabs, and a suggestions card — all reading from the DB with no new API calls at render time.

**Tech Stack:** Prisma migration, TypeScript, Next.js App Router API routes, React client components, Tailwind CSS, p-limit (already installed), BullMQ worker (existing).

## Global Constraints

- TypeScript strict mode throughout — no `any` casts except the known BullMQ/ioredis ConnectionOptions workaround
- Tailwind CSS only — no CSS modules
- All API routes under `src/app/api/`
- All React components under `src/app/dashboard/_components/`
- Worker job at `src/worker/jobs/full-sync.ts` — classification added there, not a new job
- Domain matching is case-insensitive suffix match on sender email domain
- Category priority order (first match wins): `ridesharing` > `food` > `receipts` > `newsletters` > `social` > `updates` > `promotions` > `oldmail` > `largemail`
- Gmail queries use `messages.list` with `maxResults: 1` — existence check only
- All Gmail classification queries rate-limited with `pLimit(10)` (same pattern as message fetching)
- `emailCount` must equal `inboxCount + archivedCount` after sync
- `GET /api/senders` default behaviour unchanged when `category` and `location` params absent
- `GET /api/suggestions` returns exactly top 3, sorted by `totalEmails desc`
- Dismissed suggestions stored in `localStorage` key `dismissed-suggestions` (array of category strings)

---

## File Map

```
prisma/
  schema.prisma                     — add SenderCategory enum, category/inboxCount/archivedCount to SenderGroup

src/
  lib/
    classify-sender.ts              — NEW: domain rule lookup + category priority logic
    __tests__/
      classify-sender.test.ts       — NEW: unit tests for domain matching and priority

  worker/
    jobs/
      full-sync.ts                  — MODIFY: add classification pass + inbox/archived count pass after grouping

  app/
    api/
      senders/route.ts              — MODIFY: add category + location query params, adaptive sort/filter
      suggestions/route.ts          — NEW: GET /api/suggestions — top 3 category aggregates

    dashboard/
      page.tsx                      — MODIFY: add activeCategory + activeLocation state, render new components
      _components/
        category-tabs.tsx           — NEW: horizontal scrollable category tab bar with sender count badges
        location-tabs.tsx           — NEW: Inbox / Archived secondary tab row
        suggestions-card.tsx        — NEW: Quick Wins card with dismiss per suggestion
        sender-list.tsx             — MODIFY: accept category + location props, pass to API, adapt displayed count
```

---

## Task 1: Prisma Schema — SenderCategory Enum + New Fields

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `SenderCategory` enum, `SenderGroup.category`, `SenderGroup.inboxCount`, `SenderGroup.archivedCount` available in Prisma client

- [ ] **Step 1: Add enum and fields to schema**

In `prisma/schema.prisma`, add the enum after `SenderStatus`:

```prisma
enum SenderCategory {
  newsletters
  promotions
  social
  updates
  ridesharing
  food
  receipts
  oldmail
  largemail
}
```

Add three fields to the `SenderGroup` model (after `hasUnsubscribeLink`):

```prisma
category           SenderCategory?
inboxCount         Int             @default(0)
archivedCount      Int             @default(0)
```

- [ ] **Step 2: Create and apply migration**

```bash
npx prisma migrate dev --name add-smart-categories
```

Expected: migration file created, DB updated.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat: add SenderCategory enum and inboxCount/archivedCount to SenderGroup"
```

---

## Task 2: classify-sender.ts — Domain Rules + Category Priority

**Files:**
- Create: `src/lib/classify-sender.ts`
- Create: `src/lib/__tests__/classify-sender.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORY_DOMAINS: Record<'ridesharing' | 'food' | 'receipts', string[]>` — exported constant
  - `classifyByDomain(senderEmail: string, hasUnsubscribeLink: boolean): SenderCategory | null`
  - `CATEGORY_PRIORITY: SenderCategory[]` — exported constant, in priority order

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/classify-sender.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { classifyByDomain, CATEGORY_PRIORITY } from '../classify-sender'

describe('classifyByDomain', () => {
  it('classifies uber.com as ridesharing', () => {
    expect(classifyByDomain('driver@uber.com', false)).toBe('ridesharing')
  })

  it('classifies subdomain of uber.com as ridesharing', () => {
    expect(classifyByDomain('noreply@notifications.uber.com', false)).toBe('ridesharing')
  })

  it('classifies ifood.com.br as food', () => {
    expect(classifyByDomain('noreply@ifood.com.br', false)).toBe('food')
  })

  it('classifies amazon.com as receipts', () => {
    expect(classifyByDomain('order@amazon.com', false)).toBe('receipts')
  })

  it('classifies amazon.com.br as receipts', () => {
    expect(classifyByDomain('order@amazon.com.br', false)).toBe('receipts')
  })

  it('returns newsletters when hasUnsubscribeLink is true and no domain match', () => {
    expect(classifyByDomain('news@unknown-newsletter.com', true)).toBe('newsletters')
  })

  it('returns null for unknown domain without unsubscribe link', () => {
    expect(classifyByDomain('hello@someperson.com', false)).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(classifyByDomain('noreply@UBER.COM', false)).toBe('ridesharing')
  })

  it('ridesharing takes priority over newsletters', () => {
    expect(classifyByDomain('noreply@uber.com', true)).toBe('ridesharing')
  })
})

describe('CATEGORY_PRIORITY', () => {
  it('starts with ridesharing', () => {
    expect(CATEGORY_PRIORITY[0]).toBe('ridesharing')
  })

  it('ends with largemail', () => {
    expect(CATEGORY_PRIORITY[CATEGORY_PRIORITY.length - 1]).toBe('largemail')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/lib/__tests__/classify-sender.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement classify-sender.ts**

Create `src/lib/classify-sender.ts`:

```typescript
import type { SenderCategory } from '@prisma/client'

export const CATEGORY_DOMAINS: Record<'ridesharing' | 'food' | 'receipts', string[]> = {
  ridesharing: ['uber.com', 'lyft.com', 'cabify.com', '99app.com', 'grab.com', 'bolt.eu'],
  food: [
    'ifood.com.br', 'rappi.com', 'doordash.com', 'ubereats.com',
    'deliveroo.com', 'grubhub.com', 'instacart.com', 'pedidosya.com',
  ],
  receipts: [
    'amazon.com', 'amazon.com.br', 'mercadolibre.com', 'mercadopago.com',
    'shopify.com', 'paypal.com', 'stripe.com', 'apple.com', 'google.com',
  ],
}

export const CATEGORY_PRIORITY: SenderCategory[] = [
  'ridesharing', 'food', 'receipts', 'newsletters',
  'social', 'updates', 'promotions', 'oldmail', 'largemail',
]

function domainOf(email: string): string {
  return email.toLowerCase().split('@').pop() ?? ''
}

function matchesDomain(emailDomain: string, ruleDomain: string): boolean {
  return emailDomain === ruleDomain || emailDomain.endsWith(`.${ruleDomain}`)
}

export function classifyByDomain(
  senderEmail: string,
  hasUnsubscribeLink: boolean,
): SenderCategory | null {
  const domain = domainOf(senderEmail)

  for (const [category, domains] of Object.entries(CATEGORY_DOMAINS) as [
    'ridesharing' | 'food' | 'receipts',
    string[],
  ][]) {
    if (domains.some(d => matchesDomain(domain, d))) return category
  }

  if (hasUnsubscribeLink) return 'newsletters'

  return null
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/lib/__tests__/classify-sender.test.ts
```

Expected: 9 tests PASS.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/classify-sender.ts src/lib/__tests__/classify-sender.test.ts
git commit -m "feat: add classify-sender domain rules and category priority with tests"
```

---

## Task 3: full-sync.ts — Classification Pass + Inbox/Archived Counts

**Files:**
- Modify: `src/worker/jobs/full-sync.ts`

**Interfaces:**
- Consumes: `classifyByDomain` from `@/lib/classify-sender`, `CATEGORY_PRIORITY` from `@/lib/classify-sender`
- Produces: After sync completes, every `SenderGroup` for the user has `category`, `inboxCount`, `archivedCount`, and `emailCount = inboxCount + archivedCount` set

- [ ] **Step 1: Read the current file**

Read `/Users/andersonw/workspace/flow-test/src/worker/jobs/full-sync.ts` — understand the existing flow before modifying.

- [ ] **Step 2: Add classification pass after the page-fetch loop**

After the `do { ... } while (pageToken)` loop (after all messages have been grouped into SenderGroup rows), add a classification pass:

```typescript
// --- Classification pass ---
import { classifyByDomain, CATEGORY_PRIORITY } from '@/lib/classify-sender'

// Fetch all senders for this user (only uncategorized by domain)
const allSenders = await prisma.senderGroup.findMany({
  where: { userId, status: { not: 'deleted' } },
  select: { id: true, senderEmail: true, hasUnsubscribeLink: true },
})

const classifyLimit = pLimit(10)

await Promise.all(
  allSenders.map(sender => classifyLimit(async () => {
    // Layer 1: domain rules
    const domainCategory = classifyByDomain(sender.senderEmail, sender.hasUnsubscribeLink)

    let category = domainCategory

    // Layer 2: Gmail query probes (only if domain rules didn't match)
    if (!category) {
      const queries: { q: string; cat: typeof CATEGORY_PRIORITY[number] }[] = [
        { q: `from:${sender.senderEmail} category:promotions`, cat: 'promotions' },
        { q: `from:${sender.senderEmail} category:social`, cat: 'social' },
        { q: `from:${sender.senderEmail} category:updates`, cat: 'updates' },
      ]

      for (const { q, cat } of queries) {
        const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 1 })
        if ((res.data.messages?.length ?? 0) > 0) {
          category = cat
          break
        }
      }

      // oldmail: no emails newer than 2 years
      if (!category) {
        const newRes = await gmail.users.messages.list({
          userId: 'me',
          q: `from:${sender.senderEmail} newer_than:730d`,
          maxResults: 1,
        })
        const oldRes = await gmail.users.messages.list({
          userId: 'me',
          q: `from:${sender.senderEmail} older_than:730d`,
          maxResults: 1,
        })
        if ((newRes.data.messages?.length ?? 0) === 0 && (oldRes.data.messages?.length ?? 0) > 0) {
          category = 'oldmail'
        }
      }

      // largemail: at least one email with large attachment
      if (!category) {
        const largeRes = await gmail.users.messages.list({
          userId: 'me',
          q: `from:${sender.senderEmail} has:attachment size:5000000`,
          maxResults: 1,
        })
        if ((largeRes.data.messages?.length ?? 0) > 0) {
          category = 'largemail'
        }
      }
    }

    // Inbox/archived counts
    const [inboxRes, archivedRes] = await Promise.all([
      gmail.users.messages.list({
        userId: 'me',
        q: `from:${sender.senderEmail} in:inbox`,
        maxResults: 1,
        fields: 'resultSizeEstimate',
      }),
      gmail.users.messages.list({
        userId: 'me',
        q: `from:${sender.senderEmail} -in:inbox`,
        maxResults: 1,
        fields: 'resultSizeEstimate',
      }),
    ])

    const inboxCount = inboxRes.data.resultSizeEstimate ?? 0
    const archivedCount = archivedRes.data.resultSizeEstimate ?? 0

    await prisma.senderGroup.update({
      where: { id: sender.id },
      data: {
        category: category ?? null,
        inboxCount,
        archivedCount,
        emailCount: inboxCount + archivedCount,
      },
    })
  }))
)
```

Note: `resultSizeEstimate` is an approximate count from Gmail — it's fast and good enough for display purposes. The actual `emailCount` is already accurate from the header-fetch pass; use it as a fallback if the estimate seems wrong. For now, use `resultSizeEstimate` for inbox/archived split counts.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/worker/jobs/full-sync.ts
git commit -m "feat: add classification pass and inbox/archived counts to full-sync worker"
```

---

## Task 4: GET /api/senders — category + location params

**Files:**
- Modify: `src/app/api/senders/route.ts`

**Interfaces:**
- Produces:
  - `GET /api/senders?category=food&location=inbox` — filters by category and inbox/archived
  - Response shape unchanged: `{ senders: SenderGroup[], total: number }`
  - Each sender row in response includes `inboxCount`, `archivedCount`, `category` (new fields from Prisma)

- [ ] **Step 1: Read the current file**

Read `/Users/andersonw/workspace/flow-test/src/app/api/senders/route.ts`.

- [ ] **Step 2: Add category and location params**

Replace the route with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SenderCategory } from '@prisma/client'

const VALID_CATEGORIES: SenderCategory[] = [
  'newsletters', 'promotions', 'social', 'updates',
  'ridesharing', 'food', 'receipts', 'oldmail', 'largemail',
]

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50
  const skip = (page - 1) * limit

  const categoryParam = searchParams.get('category')
  const location = searchParams.get('location') ?? 'all'

  const categoryFilter = categoryParam && VALID_CATEGORIES.includes(categoryParam as SenderCategory)
    ? { category: categoryParam as SenderCategory }
    : {}

  const locationFilter =
    location === 'inbox'    ? { inboxCount: { gt: 0 } } :
    location === 'archived' ? { archivedCount: { gt: 0 } } :
    {}

  const orderBy =
    location === 'inbox'    ? { inboxCount: 'desc' as const } :
    location === 'archived' ? { archivedCount: 'desc' as const } :
    { emailCount: 'desc' as const }

  const where = {
    userId: session.user.id,
    status: { not: 'deleted' as const },
    ...categoryFilter,
    ...locationFilter,
    ...(search
      ? {
          OR: [
            { senderEmail: { contains: search, mode: 'insensitive' as const } },
            { senderName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [senders, total] = await Promise.all([
    prisma.senderGroup.findMany({ where, orderBy, skip, take: limit }),
    prisma.senderGroup.count({ where }),
  ])

  return NextResponse.json({ senders, total })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/senders/route.ts
git commit -m "feat: add category and location filter params to GET /api/senders"
```

---

## Task 5: GET /api/suggestions

**Files:**
- Create: `src/app/api/suggestions/route.ts`

**Interfaces:**
- Produces:
```typescript
GET /api/suggestions → {
  suggestions: {
    category: SenderCategory
    label: string
    totalEmails: number
    topSenders: string[]
    senderCount: number
  }[]
}
```
  - Max 3 items, sorted by `totalEmails desc`
  - 401 if not authenticated

- [ ] **Step 1: Implement the route**

Create `src/app/api/suggestions/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SenderCategory } from '@prisma/client'

const CATEGORY_LABELS: Record<SenderCategory, string> = {
  newsletters: 'Newsletters',
  promotions: 'Promotions',
  social: 'Social notifications',
  updates: 'App updates',
  ridesharing: 'Ride sharing apps',
  food: 'Food delivery apps',
  receipts: 'Receipts & orders',
  oldmail: 'Old mail (2+ years)',
  largemail: 'Large attachments',
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const groups = await prisma.senderGroup.groupBy({
      by: ['category'],
      where: {
        userId: session.user.id,
        status: { not: 'deleted' },
        category: { not: null },
      },
      _sum: { emailCount: true },
      _count: { id: true },
      orderBy: { _sum: { emailCount: 'desc' } },
      take: 3,
    })

    const suggestions = await Promise.all(
      groups.map(async g => {
        const topSenders = await prisma.senderGroup.findMany({
          where: {
            userId: session.user.id,
            category: g.category,
            status: { not: 'deleted' },
          },
          orderBy: { emailCount: 'desc' },
          take: 3,
          select: { senderName: true },
        })

        return {
          category: g.category as SenderCategory,
          label: CATEGORY_LABELS[g.category as SenderCategory],
          totalEmails: g._sum.emailCount ?? 0,
          topSenders: topSenders.map(s => s.senderName),
          senderCount: g._count.id,
        }
      })
    )

    return NextResponse.json({ suggestions })
  } catch {
    return NextResponse.json({ suggestions: [] })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/suggestions/route.ts
git commit -m "feat: add GET /api/suggestions endpoint"
```

---

## Task 6: UI — category-tabs.tsx + location-tabs.tsx

**Files:**
- Create: `src/app/dashboard/_components/category-tabs.tsx`
- Create: `src/app/dashboard/_components/location-tabs.tsx`

**Interfaces:**
- Produces:
  - `<CategoryTabs activeCategory={string} onChange={(cat: string) => void} userId={string} />` — fetches category counts from existing senders API, renders scrollable tab bar; tabs with 0 senders hidden; "All" always shown
  - `<LocationTabs activeLocation={'all'|'inbox'|'archived'} onChange={(loc) => void} />` — static Inbox / Archived / All tabs

- [ ] **Step 1: Implement category-tabs.tsx**

Create `src/app/dashboard/_components/category-tabs.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import type { SenderCategory } from '@prisma/client'

const CATEGORY_CONFIG: { key: SenderCategory | 'all'; label: string; emoji: string }[] = [
  { key: 'all', label: 'All', emoji: '' },
  { key: 'newsletters', label: 'Newsletters', emoji: '📧' },
  { key: 'promotions', label: 'Promotions', emoji: '🏷️' },
  { key: 'receipts', label: 'Receipts', emoji: '📦' },
  { key: 'food', label: 'Food Delivery', emoji: '🍔' },
  { key: 'ridesharing', label: 'Ride Sharing', emoji: '🚗' },
  { key: 'social', label: 'Social', emoji: '💬' },
  { key: 'updates', label: 'Updates', emoji: '🔔' },
  { key: 'oldmail', label: 'Old Mail', emoji: '⏰' },
  { key: 'largemail', label: 'Large Mail', emoji: '📎' },
]

interface CategoryTabsProps {
  activeCategory: string
  onChange: (category: string) => void
}

interface CategoryCount {
  category: SenderCategory | null
  _count: { id: number }
}

export function CategoryTabs({ activeCategory, onChange }: CategoryTabsProps) {
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    async function fetchCounts() {
      // Fetch total count (for "All" tab)
      const allRes = await fetch('/api/senders?limit=1')
      if (allRes.ok) {
        const data = await allRes.json()
        setCounts(prev => ({ ...prev, all: data.total }))
      }

      // Fetch per-category counts by querying each
      await Promise.all(
        CATEGORY_CONFIG.filter(c => c.key !== 'all').map(async c => {
          const res = await fetch(`/api/senders?category=${c.key}&limit=1`)
          if (res.ok) {
            const data = await res.json()
            setCounts(prev => ({ ...prev, [c.key]: data.total }))
          }
        })
      )
    }
    fetchCounts()
  }, [])

  const visibleTabs = CATEGORY_CONFIG.filter(
    c => c.key === 'all' || (counts[c.key] ?? 0) > 0
  )

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
      {visibleTabs.map(tab => {
        const isActive = activeCategory === tab.key
        const count = counts[tab.key]
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab.emoji && <span>{tab.emoji}</span>}
            <span>{tab.label}</span>
            {count !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-blue-500 text-blue-100' : 'bg-gray-200 text-gray-600'
              }`}>
                {count.toLocaleString()}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Implement location-tabs.tsx**

Create `src/app/dashboard/_components/location-tabs.tsx`:

```typescript
'use client'

type Location = 'all' | 'inbox' | 'archived'

interface LocationTabsProps {
  activeLocation: Location
  onChange: (location: Location) => void
}

const TABS: { key: Location; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'archived', label: 'Archived' },
]

export function LocationTabs({ activeLocation, onChange }: LocationTabsProps) {
  return (
    <div className="flex gap-1">
      {TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeLocation === tab.key
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/_components/category-tabs.tsx src/app/dashboard/_components/location-tabs.tsx
git commit -m "feat: add CategoryTabs and LocationTabs components"
```

---

## Task 7: UI — suggestions-card.tsx

**Files:**
- Create: `src/app/dashboard/_components/suggestions-card.tsx`

**Interfaces:**
- Consumes: `GET /api/suggestions`
- Produces: `<SuggestionsCard onCategorySelect={(cat: string) => void} syncKey={number} />` — renders Quick Wins card; `syncKey` prop change resets dismissed state; individual dismiss stored in `localStorage` key `dismissed-suggestions`

- [ ] **Step 1: Implement suggestions-card.tsx**

Create `src/app/dashboard/_components/suggestions-card.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import type { SenderCategory } from '@prisma/client'

const CATEGORY_EMOJI: Record<SenderCategory, string> = {
  newsletters: '📧',
  promotions: '🏷️',
  social: '💬',
  updates: '🔔',
  ridesharing: '🚗',
  food: '🍔',
  receipts: '📦',
  oldmail: '⏰',
  largemail: '📎',
}

interface Suggestion {
  category: SenderCategory
  label: string
  totalEmails: number
  topSenders: string[]
  senderCount: number
}

interface SuggestionsCardProps {
  onCategorySelect: (category: string) => void
  syncKey: number
}

const DISMISSED_KEY = 'dismissed-suggestions'

function getDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
  } catch {
    return []
  }
}

function setDismissed(cats: string[]) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(cats))
}

export function SuggestionsCard({ onCategorySelect, syncKey }: SuggestionsCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [dismissed, setDismissedState] = useState<string[]>([])

  useEffect(() => {
    // Reset dismissed on new sync
    setDismissed([])
    setDismissedState([])
  }, [syncKey])

  useEffect(() => {
    setDismissedState(getDismissed())
  }, [])

  useEffect(() => {
    fetch('/api/suggestions')
      .then(r => r.ok ? r.json() : { suggestions: [] })
      .then(data => setSuggestions(data.suggestions ?? []))
      .catch(() => setSuggestions([]))
  }, [syncKey])

  const visible = suggestions.filter(s => !dismissed.includes(s.category))

  if (visible.length === 0) return null

  const handleDismiss = (category: string) => {
    const next = [...dismissed, category]
    setDismissed(next)
    setDismissedState(next)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">✨ Quick Wins</h2>
      <div className="space-y-2">
        {visible.map(s => (
          <div key={s.category} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
            <span className="text-xl">{CATEGORY_EMOJI[s.category]}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900">{s.label}</div>
              <div className="text-xs text-gray-500">
                {s.totalEmails.toLocaleString()} emails · {s.topSenders.slice(0, 3).join(', ')}
                {s.senderCount > 3 ? ` +${s.senderCount - 3} more` : ''}
              </div>
            </div>
            <button
              onClick={() => onCategorySelect(s.category)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              Clean up
            </button>
            <button
              onClick={() => handleDismiss(s.category)}
              className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/_components/suggestions-card.tsx
git commit -m "feat: add SuggestionsCard component with dismiss and localStorage"
```

---

## Task 8: Wire dashboard/page.tsx + update sender-list.tsx

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/_components/sender-list.tsx`

**Interfaces:**
- Consumes: `CategoryTabs`, `LocationTabs`, `SuggestionsCard` from Tasks 6-7
- Produces: Full dashboard with category tabs, location tabs, suggestions card; sender list filters by active category + location; count per row adapts to active location

- [ ] **Step 1: Read current sender-list.tsx**

Read `/Users/andersonw/workspace/flow-test/src/app/dashboard/_components/sender-list.tsx` to understand its current props and fetch logic.

- [ ] **Step 2: Update sender-list.tsx to accept category + location props**

Add `category: string` and `location: 'all' | 'inbox' | 'archived'` to `SenderListProps`. Pass them as query params to `GET /api/senders`. The count shown per row:
- `location === 'inbox'` → show `sender.inboxCount`
- `location === 'archived'` → show `sender.archivedCount`
- otherwise → show `sender.emailCount`

In the SenderList component:
```typescript
interface SenderListProps {
  search: string
  selectedIds: Set<string>
  onSelect: (sender: SenderGroup, checked: boolean) => void
  onUnsubscribe: (sender: SenderGroup) => void
  onDelete: (sender: SenderGroup) => void
  category: string        // new
  location: 'all' | 'inbox' | 'archived'  // new
}
```

Update the `fetchSenders` function to include params:
```typescript
const params = new URLSearchParams({
  search,
  page: String(page),
  limit: '50',
  ...(category !== 'all' ? { category } : {}),
  ...(location !== 'all' ? { location } : {}),
})
```

Pass `location` down to `SenderRow` so it can pick the right count. Add a `location` prop to `SenderRow`:
```typescript
interface SenderRowProps {
  sender: SenderGroup
  selected: boolean
  onSelect: (id: string, checked: boolean) => void
  onUnsubscribe: (sender: SenderGroup) => void
  onDelete: (sender: SenderGroup) => void
  location: 'all' | 'inbox' | 'archived'  // new
}
```

In `SenderRow`, replace the hardcoded `sender.emailCount` display with:
```typescript
const displayCount =
  location === 'inbox' ? sender.inboxCount :
  location === 'archived' ? sender.archivedCount :
  sender.emailCount
```

- [ ] **Step 3: Update dashboard/page.tsx**

Replace `src/app/dashboard/page.tsx` with:

```typescript
'use client'

import { useState, useCallback } from 'react'
import type { SenderGroup } from '@prisma/client'
import { SenderList } from './_components/sender-list'
import { UnsubscribeModal } from './_components/unsubscribe-modal'
import { DeleteConfirmModal } from './_components/delete-confirm-modal'
import { CategoryTabs } from './_components/category-tabs'
import { LocationTabs } from './_components/location-tabs'
import { SuggestionsCard } from './_components/suggestions-card'

type Location = 'all' | 'inbox' | 'archived'

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeLocation, setActiveLocation] = useState<Location>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedNames, setSelectedNames] = useState<Map<string, string>>(new Map())
  const [unsubscribeSender, setUnsubscribeSender] = useState<SenderGroup | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; names: string[] } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleSelect = useCallback((sender: SenderGroup, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      checked ? next.add(sender.id) : next.delete(sender.id)
      return next
    })
    setSelectedNames(prev => {
      const next = new Map(prev)
      checked ? next.set(sender.id, sender.senderName) : next.delete(sender.id)
      return next
    })
  }, [])

  const handleDeleteSingle = (sender: SenderGroup) => {
    setDeleteTarget({ ids: [sender.id], names: [sender.senderName] })
  }

  const handleBulkDelete = () => {
    setDeleteTarget({ ids: [...selectedIds], names: [...selectedNames.values()] })
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderGroupIds: deleteTarget.ids }),
    })
    setSelectedIds(new Set())
    setSelectedNames(new Map())
    setRefreshKey(k => k + 1)
  }

  const handleUnsubscribeSuccess = () => {
    setRefreshKey(k => k + 1)
  }

  const handleCategorySelect = (category: string) => {
    setActiveCategory(category)
    setSelectedIds(new Set())
    setSelectedNames(new Map())
  }

  return (
    <div>
      <SuggestionsCard onCategorySelect={handleCategorySelect} syncKey={refreshKey} />

      <div className="mb-3">
        <CategoryTabs activeCategory={activeCategory} onChange={handleCategorySelect} />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <LocationTabs activeLocation={activeLocation} onChange={setActiveLocation} />
        <input
          type="text"
          placeholder="Search senders..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <SenderList
          key={`${refreshKey}-${activeCategory}-${activeLocation}`}
          search={search}
          selectedIds={selectedIds}
          onSelect={(sender, checked) => handleSelect(sender, checked)}
          onUnsubscribe={setUnsubscribeSender}
          onDelete={handleDeleteSingle}
          category={activeCategory}
          location={activeLocation}
        />
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 text-sm">
          <span>{selectedIds.size} selected</span>
          <button
            onClick={handleBulkDelete}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 rounded-full transition-colors"
          >
            Delete all
          </button>
          <button
            onClick={() => alert('Select a single sender and click Unsubscribe to unsubscribe one at a time.')}
            className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 rounded-full transition-colors"
          >
            Unsubscribe selected
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setSelectedNames(new Map()) }}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {unsubscribeSender && (
        <UnsubscribeModal
          sender={unsubscribeSender}
          onClose={() => setUnsubscribeSender(null)}
          onSuccess={handleUnsubscribeSuccess}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          senderIds={deleteTarget.ids}
          senderNames={deleteTarget.names}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Verify all existing Vitest tests still pass**

```bash
npx vitest run src/lib/__tests__/
```

Expected: all tests PASS (including 2 existing + 9 new from Task 2).

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/_components/sender-list.tsx src/app/dashboard/_components/sender-row.tsx
git commit -m "feat: wire category tabs, location tabs, and suggestions card into dashboard"
```
