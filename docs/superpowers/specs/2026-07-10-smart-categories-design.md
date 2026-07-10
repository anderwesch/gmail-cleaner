# Smart Categories & Quick Wins — Design Spec

**Date:** 2026-07-10
**Status:** Approved

---

## Overview

Add smart inbox categories, inbox/archived split, and a "Quick Wins" suggestions card to the Gmail Cleanup dashboard. Categories are detected during the existing sync pipeline using Gmail query patterns and domain rules — no extra AI or separate jobs needed. The UI gains a category tab bar, an inbox/archived toggle, and a top-of-dashboard suggestions card.

---

## Categories

| Key | Label | Detection method |
|---|---|---|
| `newsletters` | Newsletters | `hasUnsubscribeLink = true` (already in sync) |
| `promotions` | Promotions | Gmail query: `category:promotions` |
| `social` | Social | Gmail query: `category:social` |
| `updates` | Updates | Gmail query: `category:updates` |
| `ridesharing` | Ride Sharing | Domain rules (see below) |
| `food` | Food Delivery | Domain rules (see below) |
| `receipts` | Receipts & Orders | Domain rules (see below) |
| `oldmail` | Old Mail | Gmail query: sender has no email newer than 2 years (`older_than:2y`) |
| `largemail` | Large Mail | Gmail query: sender has at least one email `has:attachment size:5m` |

**Priority order** when a sender matches multiple categories (first match wins):
`ridesharing` > `food` > `receipts` > `newsletters` > `social` > `updates` > `promotions` > `oldmail` > `largemail`

Senders matching none: shown under "All" only, category is `null`.

---

## Domain Rules

```
ridesharing:
  uber.com, lyft.com, cabify.com, 99app.com, grab.com, bolt.eu

food:
  ifood.com.br, rappi.com, doordash.com, ubereats.com, deliveroo.com,
  grubhub.com, instacart.com, pedidosya.com

receipts:
  amazon.com, amazon.com.br, mercadolibre.com, mercadopago.com,
  shopify.com, paypal.com, stripe.com, apple.com, google.com
```

Domain matching is case-insensitive suffix match on the sender email domain.

---

## Data Model Changes

### SenderGroup — two new fields

```
category        SenderCategory?  — null if uncategorized
inboxCount      Int @default(0)  — emails matching in:inbox
archivedCount   Int @default(0)  — emails matching -in:inbox
```

`emailCount` remains and is updated during sync to `inboxCount + archivedCount`. Kept for backward compat with existing sort and delete logic.

### New enum

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

### New Prisma migration

`prisma migrate dev --name add-smart-categories`

---

## Classification Logic (sync worker)

Classification runs inside the existing `full-sync` job after sender grouping. Two layers:

**Layer 1 — Domain rules** (applied at grouping time, no API call):
- Check `senderEmail` domain suffix against each domain list
- Assign category by priority order
- Also sets `newsletters` if `hasUnsubscribeLink = true` and no higher-priority category matched

**Layer 2 — Gmail query verification** (one query per sender, batched):
For senders not yet categorized by domain rules, run Gmail queries:
- `from:sender@email.com category:promotions` → `promotions`
- `from:sender@email.com category:social` → `social`
- `from:sender@email.com category:updates` → `updates`
- `from:sender@email.com older_than:2y` + no results for `from:sender@email.com newer_than:2y` → `oldmail`
- `from:sender@email.com has:attachment size:5m` → `largemail`

Queries use `messages.list` with `maxResults: 1` — we only need to know if any match exists, not fetch all messages. Rate-limited to 10 concurrent queries using existing `p-limit` pattern.

**Inbox/archived count:**
For each sender, after category is assigned, run two counts:
- `from:sender@email.com in:inbox` → `inboxCount`
- `from:sender@email.com -in:inbox` → `archivedCount`

These replace the existing single `emailCount` fetch.

---

## API Changes

### `GET /api/senders`

Two new optional query params:

| Param | Values | Default | Behaviour |
|---|---|---|---|
| `category` | `newsletters`, `promotions`, ... , `all` | `all` | Filter by category |
| `location` | `inbox`, `archived`, `all` | `all` | Filter by inbox/archived |

When `location=inbox`: filter `inboxCount > 0`, sort by `inboxCount desc`.
When `location=archived`: filter `archivedCount > 0`, sort by `archivedCount desc`.
When `location=all`: sort by `emailCount desc` (existing behaviour).

The count shown in each sender row adapts to the active `location`: `inbox` → shows `inboxCount`, `archived` → shows `archivedCount`, `all` → shows `emailCount` (total).

### `GET /api/suggestions`

New endpoint. Returns top 3 cleanup suggestions based on DB aggregates — no Gmail API call.

**Response:**
```typescript
{
  suggestions: {
    category: SenderCategory
    label: string           // "Food delivery apps"
    totalEmails: number     // sum of emailCount for all senders in category
    topSenders: string[]    // top 3 sender names by emailCount
    senderCount: number     // total senders in category
  }[]
}
```

**Ranking logic** (SQL aggregates, computed server-side):
1. Group senders by category, sum `emailCount`
2. Exclude categories with 0 senders
3. Sort by `totalEmails desc`
4. Return top 3

---

## UI Changes

### Dashboard layout

```
┌─────────────────────────────────────────────────────┐
│  Header (sync status, avatar)                       │
├─────────────────────────────────────────────────────┤
│  Quick Wins card (if suggestions exist)             │
├─────────────────────────────────────────────────────┤
│  [All] [Newsletters 142] [Promotions 89] [Food 34]  │
│  [Ride Sharing 12] [Receipts 67] ...  (scrollable)  │
├─────────────────────────────────────────────────────┤
│  [Inbox]  [Archived]          🔍 Search...          │
├─────────────────────────────────────────────────────┤
│  Sender list                                        │
└─────────────────────────────────────────────────────┘
```

### New components

**`category-tabs.tsx`** — Horizontal scrollable tab bar. Each tab shows label + sender count badge. Tabs with 0 senders are hidden. "All" tab always shown. Active tab highlighted.

**`location-tabs.tsx`** — Secondary "Inbox / Archived" tab row. Shown below category tabs. Selecting "Inbox" filters senders to `inboxCount > 0`; "Archived" to `archivedCount > 0`.

**`suggestions-card.tsx`** — "Quick Wins" card at top of dashboard. Shows up to 3 suggestions. Each row: category emoji + label + total email count + top sender names + "Clean up" button. "Clean up" navigates to that category tab with all senders pre-selected. User can dismiss individual suggestions (stored in `localStorage`, key: `dismissed-suggestions`, value: array of dismissed category keys). Dismissed suggestions reset when a new sync completes.

### Modified components

**`sender-list.tsx`** — Accepts `category` and `location` props, passes them as query params to `GET /api/senders`. Displayed count per row adapts to active `location` tab.

**`dashboard/page.tsx`** — Manages `activeCategory` and `activeLocation` state. Passes to `CategoryTabs`, `LocationTabs`, and `SenderList`. Renders `SuggestionsCard` above the tabs.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Gmail category query returns 0 results | Sender stays uncategorized (`category: null`) |
| Gmail query for inbox/archived count fails | Fallback: `inboxCount = emailCount`, `archivedCount = 0` |
| `/api/suggestions` DB query fails | Card silently hidden (no error shown to user) |
| All suggestions dismissed | Card hidden entirely |

---

## Out of Scope (v1)

- AI-powered classification (planned for v2)
- User-defined custom categories
- Per-category bulk unsubscribe (bulk delete only for now)
- Category counts in the sync progress indicator
- Editing the domain rules list from the UI
