# Gmail Cleanup App — Design Spec

**Date:** 2026-07-10
**Status:** Approved

---

## Overview

A web app that helps users clean up their Gmail inbox by grouping emails by sender, bulk deleting, and unsubscribing from mailing lists. Inspired by clean.email. Supports multiple users via Google OAuth. Built with Next.js, PostgreSQL, and BullMQ on Railway.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Next.js App                       │
│  ┌─────────────┐        ┌──────────────────────┐   │
│  │  React UI   │◄──────►│  API Routes          │   │
│  │  (App Router│        │  /auth, /senders,    │   │
│  │   pages)    │        │  /unsubscribe,       │   │
│  └─────────────┘        │  /delete, /sync      │   │
│                         └──────────┬───────────┘   │
└────────────────────────────────────┼───────────────┘
                                     │
              ┌──────────────────────┼────────────────┐
              │                      │                 │
       ┌──────▼──────┐      ┌────────▼──────┐  ┌──────▼─────┐
       │  PostgreSQL  │      │  BullMQ +     │  │  Gmail API │
       │  (Prisma)    │      │  Redis (jobs) │  │  (Google)  │
       └─────────────┘      └───────────────┘  └────────────┘
                                     │
                            ┌────────▼────────┐
                            │  Worker Process  │
                            │  (sync jobs)     │
                            └─────────────────┘
```

**Key components:**

- **Next.js (App Router)** — UI and API routes in a single codebase
- **NextAuth.js** — Google OAuth with `gmail.modify` scope; handles token refresh automatically
- **PostgreSQL + Prisma** — stores users, sender groups, sync state, and action history
- **BullMQ + Redis** — queues and processes background sync jobs
- **Worker process** — runs separately from the web server, processes the BullMQ queue
- **Railway** — deployment platform; natively supports all four services (web, worker, Postgres, Redis)

---

## Data Model

### User
```
id                  UUID, primary key
email               string, unique
name                string
avatar              string (URL)
googleAccessToken   string (encrypted)
googleRefreshToken  string (encrypted)
lastSyncedAt        datetime, nullable
syncStatus          enum: idle | syncing | error
createdAt           datetime
```

### SenderGroup
```
id                  UUID, primary key
userId              FK → User
senderEmail         string
senderName          string
emailCount          integer
latestEmailDate     datetime
hasUnsubscribeLink  boolean
unsubscribeUrl      string, nullable
unsubscribeEmail    string, nullable
status              enum: active | unsubscribed | deleted
createdAt           datetime
updatedAt           datetime

index: (userId, senderEmail) unique
index: (userId, emailCount DESC) — for sorted dashboard queries
```

### SyncJob
```
id                  UUID, primary key
userId              FK → User
status              enum: queued | running | completed | failed
progress            integer (0–100)
totalEmails         integer, nullable
processedEmails     integer
startedAt           datetime, nullable
completedAt         datetime, nullable
errorMessage        string, nullable
```

### UnsubscribeAction
```
id                  UUID, primary key
userId              FK → User
senderGroupId       FK → SenderGroup
method              enum: link | email
performedAt         datetime
deleteExisting      boolean
emailsDeleted       integer
```

### DeleteAction
```
id                  UUID, primary key
userId              FK → User
senderGroupId       FK → SenderGroup
emailsDeleted       integer
performedAt         datetime
```

---

## Gmail API Integration

**OAuth scope:** `https://www.googleapis.com/auth/gmail.modify`
Allows reading, labeling, and deleting messages. Does not grant access to compose or send.

**Initial sync flow:**
1. After login, enqueue a `full-sync` job for the user
2. Worker calls `messages.list` with pagination (pageToken) to collect all message IDs
3. Batch-fetch headers in groups of 100 using `messages.batchGet` — only fetch `From` and `List-Unsubscribe` headers (minimal payload)
4. Group by normalized sender email, aggregate counts and latest date
5. Parse `List-Unsubscribe` header: extract URL (`https://...`) and/or mailto (`mailto:...`)
6. Upsert into `SenderGroup` table as batches are processed
7. Store progress in `SyncJob.processedEmails` — UI polls `/api/sync/status` every 3 seconds during active sync

**Checkpoint/resume:** Store the last processed Gmail `pageToken` in `SyncJob`. On failure, re-queue picks up from the last checkpoint rather than restarting from scratch.

**Bulk delete:** Use `messages.batchDelete` (max 1,000 per call). For senders with more than 1,000 emails, chunk into multiple sequential calls.

**Unsubscribe via link:** Open the URL in a new tab — the user completes the unsubscribe flow on the sender's site. The modal stays open with a "I've unsubscribed" button; clicking it marks the sender as unsubscribed in the app.

**Unsubscribe via email:** Send a `POST` to the `mailto:` address using the Gmail API `messages.send` with the required unsubscribe body.

---

## UI & User Flows

### Pages

| Route | Description |
|---|---|
| `/` | Landing page with "Sign in with Google" button |
| `/dashboard` | Main sender list view |
| `/dashboard/sender/:id` | Detail view for a single sender (future) |

### Dashboard

- **Header:** user avatar, sync status badge (`Syncing... 1,240 / 45,000`), Re-sync button
- **Search bar:** filter sender list by name or email address
- **Sender list:** sorted by email count descending, each row shows:
  - Sender name + email address
  - Email count + date of latest email
  - Unsubscribe button (shown only if `hasUnsubscribeLink = true`)
  - Delete all button
  - Checkbox for bulk selection
- **Bulk action bar:** appears at bottom when ≥1 sender is checked — "Unsubscribe selected" / "Delete all from selected"

### First Login / Sync Flow

1. User clicks "Sign in with Google" → Google OAuth consent screen
2. On success, redirected to `/dashboard`
3. Background sync starts automatically; progress bar shown in header
4. Sender rows appear as sync batches complete (UI polls every 3 seconds)
5. Sync complete → progress bar replaced by "Last synced: just now" + Re-sync button

### Unsubscribe Flow

1. User clicks Unsubscribe on a sender row
2. Modal: "Also delete [X] existing emails from [Sender Name]?"
   - "Yes, delete them" → unsubscribe + bulk delete
   - "No, just unsubscribe" → unsubscribe only
3. App performs unsubscribe (link or email method)
4. Sender row status updates to "Unsubscribed" with strikethrough
5. If delete was selected, email count updates to 0

### Bulk Action Flow

1. User checks multiple senders
2. Bulk action bar appears: "3 senders selected"
3. User clicks "Delete all from selected"
4. Confirmation modal: "Delete all emails from 3 senders? This cannot be undone."
5. Jobs queued, UI shows per-row progress indicators

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Gmail API rate limit (429) | BullMQ retries with exponential backoff, up to 5 attempts |
| Expired or revoked Google token | Sync job sets `syncStatus: error`; UI shows "Reconnect your Google account" with re-auth button |
| Unsubscribe link fails to open | Toast: "Couldn't open unsubscribe link. Here's the URL: [link]" |
| Unsubscribe email send fails | Toast: "Couldn't send unsubscribe request. Try again or visit the sender's site." |
| Partial sync failure | Checkpoint stored in `SyncJob`; re-sync resumes from last pageToken |
| Bulk delete partial failure | Per-sender error toast; only rows confirmed deleted by API are marked as deleted in DB |
| Sender with 0 unsubscribe header | No Unsubscribe button shown; Delete only |

---

## Testing Strategy

- **Unit tests (Vitest):** data parsing (sender grouping logic, `List-Unsubscribe` header parsing), Prisma query helpers
- **Integration tests:** API routes tested against a real test PostgreSQL instance (not mocked)
- **E2E tests (Playwright):** login flow, sync progress display, unsubscribe modal, bulk delete confirmation
- **Gmail API:** use a dedicated test Gmail account with a known set of emails for integration tests; mock the Gmail client in unit tests

---

## Deployment (Railway)

Four Railway services from one GitHub repo:

| Service | Type | Notes |
|---|---|---|
| `web` | Node.js (Next.js) | `npm run start` |
| `worker` | Node.js | `npm run worker` — BullMQ consumer |
| `postgres` | Managed PostgreSQL | Railway plugin |
| `redis` | Managed Redis | Railway plugin |

Environment variables shared via Railway's variable groups: `DATABASE_URL`, `REDIS_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.

---

## Out of Scope (v1)

- Email preview / reading emails in-app
- Smart category detection (Promotions, Receipts, etc.)
- Gmail History API for incremental sync (can upgrade later)
- Mobile app
- Email archiving (archive without delete)
- Filters / rules for auto-cleanup
