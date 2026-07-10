# Gmail Cleanup App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-user web app that groups Gmail by sender, lets users bulk delete emails, and one-click unsubscribe from mailing lists.

**Architecture:** Next.js App Router handles both the React UI and API routes. A separate Node.js worker process consumes BullMQ jobs from Redis to run background Gmail syncs. PostgreSQL via Prisma stores users, sender groups, sync state, and action history.

**Tech Stack:** Next.js 14, NextAuth.js v5, Prisma 5, PostgreSQL, BullMQ, Redis, Vitest, Playwright, Tailwind CSS, googleapis npm package.

## Global Constraints

- Node.js >= 20
- Next.js App Router only — no Pages Router
- All API routes under `src/app/api/`
- All React components under `src/app/` or `src/components/`
- Worker entrypoint at `src/worker/index.ts`
- Prisma schema at `prisma/schema.prisma`
- Tests use Vitest for unit/integration, Playwright for E2E
- No mocking of PostgreSQL in integration tests — use a real test DB via `DATABASE_URL_TEST`
- Gmail API client always mocked in unit tests
- All tokens stored encrypted in DB using AES-256 via `ENCRYPTION_KEY` env var
- Tailwind CSS for all styling — no CSS modules or styled-components
- TypeScript strict mode throughout

---

## File Map

```
prisma/
  schema.prisma               — all models: User, SenderGroup, SyncJob, UnsubscribeAction, DeleteAction

src/
  lib/
    prisma.ts                 — singleton Prisma client
    redis.ts                  — singleton Redis/BullMQ connection
    gmail.ts                  — Gmail API client factory (takes access token)
    crypto.ts                 — encrypt/decrypt token helpers
    parse-unsubscribe.ts      — parse List-Unsubscribe header → { url, email }
    group-senders.ts          — aggregate raw message headers into SenderGroup upsert data

  worker/
    index.ts                  — BullMQ worker entrypoint, registers job processors
    jobs/
      full-sync.ts            — full-sync job: fetch all message headers, upsert SenderGroups
      bulk-delete.ts          — bulk-delete job: delete emails in chunks of 1000
      send-unsubscribe.ts     — send unsubscribe email via Gmail API

  app/
    layout.tsx                — root layout: SessionProvider, Toaster
    page.tsx                  — landing page: Sign in with Google
    dashboard/
      page.tsx                — dashboard: sender list, search, bulk action bar
      layout.tsx              — dashboard layout: header with sync status
      _components/
        sender-row.tsx        — single sender row: name, count, buttons, checkbox
        sender-list.tsx       — virtualized list of sender rows
        sync-status.tsx       — header sync badge + progress bar
        unsubscribe-modal.tsx — unsubscribe + optional delete modal
        bulk-action-bar.tsx   — floating bar when ≥1 sender selected
        delete-confirm-modal.tsx — confirmation modal for bulk delete

    api/
      auth/
        [...nextauth]/route.ts — NextAuth Google OAuth handler
      senders/
        route.ts              — GET /api/senders — list SenderGroups for authed user
      sync/
        route.ts              — POST /api/sync — enqueue full-sync job
        status/route.ts       — GET /api/sync/status — latest SyncJob status
      unsubscribe/
        route.ts              — POST /api/unsubscribe — mark unsubscribed, optionally enqueue delete
      delete/
        route.ts              — POST /api/delete — enqueue bulk-delete job for sender(s)

  types/
    index.ts                  — shared TypeScript types used across app and worker
```

---

## Task 1: Project Scaffold & Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `next.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`

**Interfaces:**
- Produces: a running Next.js dev server at `localhost:3000`

- [ ] **Step 1: Initialize Next.js project with TypeScript and Tailwind**

```bash
npx create-next-app@14 . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-git
```

Expected: project files created, `npm run dev` works.

- [ ] **Step 2: Install core dependencies**

```bash
npm install \
  next-auth@beta \
  @prisma/client \
  prisma \
  bullmq \
  ioredis \
  googleapis \
  @google-cloud/local-auth
```

```bash
npm install --save-dev \
  vitest \
  @vitejs/plugin-react \
  @testing-library/react \
  @testing-library/jest-dom \
  @playwright/test \
  vite-tsconfig-paths
```

- [ ] **Step 3: Create `.env.example`**

```bash
cat > .env.example << 'EOF'
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/gmailcleanup"
DATABASE_URL_TEST="postgresql://user:password@localhost:5432/gmailcleanup_test"

# Redis
REDIS_URL="redis://localhost:6379"

# Google OAuth
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# NextAuth
NEXTAUTH_SECRET=""
NEXTAUTH_URL="http://localhost:3000"

# Encryption (32-byte hex string)
ENCRYPTION_KEY=""
EOF
```

- [ ] **Step 4: Create `.gitignore` additions**

Append to the generated `.gitignore`:
```
.env
.env.local
.env.*.local
```

- [ ] **Step 5: Add vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
  },
})
```

- [ ] **Step 6: Add worker script to package.json**

Add to `scripts` in `package.json`:
```json
"worker": "tsx src/worker/index.ts"
```

Install tsx:
```bash
npm install --save-dev tsx
```

- [ ] **Step 7: Start dev server and verify it loads**

```bash
npm run dev
```

Expected: `localhost:3000` returns the default Next.js page with no errors in console.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Tailwind, Vitest, dependencies"
```

---

## Task 2: Database Schema & Prisma Setup

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`

**Interfaces:**
- Produces: `import { prisma } from '@/lib/prisma'` — singleton Prisma client usable in API routes and worker

- [ ] **Step 1: Write the Prisma schema**

Create `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                 String        @id @default(uuid())
  email              String        @unique
  name               String
  avatar             String?
  googleAccessToken  String
  googleRefreshToken String
  lastSyncedAt       DateTime?
  syncStatus         SyncStatus    @default(idle)
  createdAt          DateTime      @default(now())

  senderGroups       SenderGroup[]
  syncJobs           SyncJob[]
  unsubscribeActions UnsubscribeAction[]
  deleteActions      DeleteAction[]
}

enum SyncStatus {
  idle
  syncing
  error
}

model SenderGroup {
  id                 String        @id @default(uuid())
  userId             String
  senderEmail        String
  senderName         String
  emailCount         Int           @default(0)
  latestEmailDate    DateTime?
  hasUnsubscribeLink Boolean       @default(false)
  unsubscribeUrl     String?
  unsubscribeEmail   String?
  status             SenderStatus  @default(active)
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  user               User          @relation(fields: [userId], references: [id])
  unsubscribeActions UnsubscribeAction[]
  deleteActions      DeleteAction[]

  @@unique([userId, senderEmail])
  @@index([userId, emailCount(sort: Desc)])
}

enum SenderStatus {
  active
  unsubscribed
  deleted
}

model SyncJob {
  id              String     @id @default(uuid())
  userId          String
  status          JobStatus  @default(queued)
  progress        Int        @default(0)
  totalEmails     Int?
  processedEmails Int        @default(0)
  pageTokenCursor String?
  startedAt       DateTime?
  completedAt     DateTime?
  errorMessage    String?

  user            User       @relation(fields: [userId], references: [id])
}

enum JobStatus {
  queued
  running
  completed
  failed
}

model UnsubscribeAction {
  id              String      @id @default(uuid())
  userId          String
  senderGroupId   String
  method          UnsubMethod
  performedAt     DateTime    @default(now())
  deleteExisting  Boolean
  emailsDeleted   Int         @default(0)

  user            User        @relation(fields: [userId], references: [id])
  senderGroup     SenderGroup @relation(fields: [senderGroupId], references: [id])
}

enum UnsubMethod {
  link
  email
}

model DeleteAction {
  id            String      @id @default(uuid())
  userId        String
  senderGroupId String
  emailsDeleted Int
  performedAt   DateTime    @default(now())

  user          User        @relation(fields: [userId], references: [id])
  senderGroup   SenderGroup @relation(fields: [senderGroupId], references: [id])
}
```

- [ ] **Step 2: Create singleton Prisma client**

Create `src/lib/prisma.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 3: Run Prisma migration**

```bash
npx prisma migrate dev --name init
```

Expected: migration file created under `prisma/migrations/`, tables created in your local PostgreSQL.

- [ ] **Step 4: Generate Prisma client**

```bash
npx prisma generate
```

Expected: `node_modules/@prisma/client` updated with your types.

- [ ] **Step 5: Verify schema compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/lib/prisma.ts
git commit -m "feat: add Prisma schema and singleton client"
```

---

## Task 3: Crypto, Redis, and Shared Lib Utilities

**Files:**
- Create: `src/lib/crypto.ts`
- Create: `src/lib/redis.ts`
- Create: `src/lib/parse-unsubscribe.ts`
- Create: `src/lib/group-senders.ts`
- Create: `src/types/index.ts`
- Create: `src/lib/__tests__/parse-unsubscribe.test.ts`
- Create: `src/lib/__tests__/group-senders.test.ts`

**Interfaces:**
- Produces:
  - `encrypt(plaintext: string): string` — AES-256-GCM, returns `iv:authTag:ciphertext` hex string
  - `decrypt(ciphertext: string): string`
  - `getQueue(name: string): Queue` — BullMQ Queue connected to Redis
  - `parseUnsubscribeHeader(header: string): { url: string | null; email: string | null }` 
  - `groupMessageHeaders(messages: RawMessage[]): SenderUpsertData[]`
  - Types: `RawMessage`, `SenderUpsertData` from `@/types`

- [ ] **Step 1: Write shared types**

Create `src/types/index.ts`:
```typescript
export interface RawMessage {
  id: string
  from: string
  listUnsubscribe: string | null
  internalDate: string // milliseconds since epoch as string
}

export interface SenderUpsertData {
  senderEmail: string
  senderName: string
  emailCount: number
  latestEmailDate: Date
  hasUnsubscribeLink: boolean
  unsubscribeUrl: string | null
  unsubscribeEmail: string | null
}

export interface SyncStatusResponse {
  status: 'idle' | 'syncing' | 'error'
  progress: number
  totalEmails: number | null
  processedEmails: number
  errorMessage: string | null
}
```

- [ ] **Step 2: Write parse-unsubscribe tests**

Create `src/lib/__tests__/parse-unsubscribe.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { parseUnsubscribeHeader } from '../parse-unsubscribe'

describe('parseUnsubscribeHeader', () => {
  it('extracts https URL', () => {
    const result = parseUnsubscribeHeader('<https://example.com/unsub?token=abc>')
    expect(result.url).toBe('https://example.com/unsub?token=abc')
    expect(result.email).toBeNull()
  })

  it('extracts mailto address', () => {
    const result = parseUnsubscribeHeader('<mailto:unsub@example.com?subject=unsubscribe>')
    expect(result.url).toBeNull()
    expect(result.email).toBe('unsub@example.com')
  })

  it('extracts both when present', () => {
    const result = parseUnsubscribeHeader(
      '<https://example.com/unsub>, <mailto:unsub@example.com>'
    )
    expect(result.url).toBe('https://example.com/unsub')
    expect(result.email).toBe('unsub@example.com')
  })

  it('returns nulls for empty string', () => {
    const result = parseUnsubscribeHeader('')
    expect(result.url).toBeNull()
    expect(result.email).toBeNull()
  })
})
```

- [ ] **Step 3: Run test — verify it fails**

```bash
npx vitest run src/lib/__tests__/parse-unsubscribe.test.ts
```

Expected: FAIL — `parseUnsubscribeHeader` not found.

- [ ] **Step 4: Implement parseUnsubscribeHeader**

Create `src/lib/parse-unsubscribe.ts`:
```typescript
export function parseUnsubscribeHeader(header: string): {
  url: string | null
  email: string | null
} {
  if (!header) return { url: null, email: null }

  const urlMatch = header.match(/<(https?:\/\/[^>]+)>/)
  const mailtoMatch = header.match(/<mailto:([^?>\s]+)/)

  return {
    url: urlMatch ? urlMatch[1] : null,
    email: mailtoMatch ? mailtoMatch[1] : null,
  }
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
npx vitest run src/lib/__tests__/parse-unsubscribe.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Write group-senders tests**

Create `src/lib/__tests__/group-senders.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { groupMessageHeaders } from '../group-senders'
import type { RawMessage } from '@/types'

describe('groupMessageHeaders', () => {
  it('groups messages by normalized sender email', () => {
    const messages: RawMessage[] = [
      { id: '1', from: 'News <news@example.com>', listUnsubscribe: null, internalDate: '1700000000000' },
      { id: '2', from: 'News <news@example.com>', listUnsubscribe: null, internalDate: '1700000001000' },
      { id: '3', from: 'Other <other@example.com>', listUnsubscribe: null, internalDate: '1700000002000' },
    ]
    const result = groupMessageHeaders(messages)
    expect(result).toHaveLength(2)
    const newsGroup = result.find(r => r.senderEmail === 'news@example.com')
    expect(newsGroup?.emailCount).toBe(2)
  })

  it('uses the latest internalDate as latestEmailDate', () => {
    const messages: RawMessage[] = [
      { id: '1', from: 'News <news@example.com>', listUnsubscribe: null, internalDate: '1700000000000' },
      { id: '2', from: 'News <news@example.com>', listUnsubscribe: null, internalDate: '1700000005000' },
    ]
    const result = groupMessageHeaders(messages)
    expect(result[0].latestEmailDate).toEqual(new Date(1700000005000))
  })

  it('sets hasUnsubscribeLink true when header has URL', () => {
    const messages: RawMessage[] = [
      {
        id: '1',
        from: 'News <news@example.com>',
        listUnsubscribe: '<https://example.com/unsub>',
        internalDate: '1700000000000',
      },
    ]
    const result = groupMessageHeaders(messages)
    expect(result[0].hasUnsubscribeLink).toBe(true)
    expect(result[0].unsubscribeUrl).toBe('https://example.com/unsub')
  })

  it('handles From header with no display name', () => {
    const messages: RawMessage[] = [
      { id: '1', from: 'plain@example.com', listUnsubscribe: null, internalDate: '1700000000000' },
    ]
    const result = groupMessageHeaders(messages)
    expect(result[0].senderEmail).toBe('plain@example.com')
    expect(result[0].senderName).toBe('plain@example.com')
  })
})
```

- [ ] **Step 7: Run test — verify it fails**

```bash
npx vitest run src/lib/__tests__/group-senders.test.ts
```

Expected: FAIL — `groupMessageHeaders` not found.

- [ ] **Step 8: Implement groupMessageHeaders**

Create `src/lib/group-senders.ts`:
```typescript
import type { RawMessage, SenderUpsertData } from '@/types'
import { parseUnsubscribeHeader } from './parse-unsubscribe'

function parseFrom(from: string): { email: string; name: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].toLowerCase() }
  }
  const email = from.trim().toLowerCase()
  return { name: email, email }
}

export function groupMessageHeaders(messages: RawMessage[]): SenderUpsertData[] {
  const map = new Map<string, SenderUpsertData>()

  for (const msg of messages) {
    const { email, name } = parseFrom(msg.from)
    const date = new Date(parseInt(msg.internalDate, 10))
    const unsub = parseUnsubscribeHeader(msg.listUnsubscribe ?? '')

    const existing = map.get(email)
    if (existing) {
      existing.emailCount += 1
      if (date > existing.latestEmailDate) existing.latestEmailDate = date
      if (unsub.url && !existing.unsubscribeUrl) {
        existing.unsubscribeUrl = unsub.url
        existing.hasUnsubscribeLink = true
      }
      if (unsub.email && !existing.unsubscribeEmail) {
        existing.unsubscribeEmail = unsub.email
      }
    } else {
      map.set(email, {
        senderEmail: email,
        senderName: name,
        emailCount: 1,
        latestEmailDate: date,
        hasUnsubscribeLink: !!unsub.url,
        unsubscribeUrl: unsub.url,
        unsubscribeEmail: unsub.email,
      })
    }
  }

  return Array.from(map.values())
}
```

- [ ] **Step 9: Run tests — verify both pass**

```bash
npx vitest run src/lib/__tests__/
```

Expected: 8 tests PASS.

- [ ] **Step 10: Implement crypto utilities**

Create `src/lib/crypto.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 11: Implement Redis/BullMQ connection**

Create `src/lib/redis.ts`:
```typescript
import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis: IORedis }

export const redis =
  globalForRedis.redis ??
  new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis

export function getQueue(name: string): Queue {
  return new Queue(name, { connection: redis })
}

export { Worker }
```

- [ ] **Step 12: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add src/lib/ src/types/
git commit -m "feat: add crypto, redis, parse-unsubscribe, group-senders utilities with tests"
```

---

## Task 4: Google OAuth with NextAuth

**Files:**
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/lib/auth.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces:
  - `auth()` — NextAuth session helper, returns `{ user: { id, email, name, image } } | null`
  - `GET/POST /api/auth/[...nextauth]` — NextAuth handler (sign in, callback, sign out)
  - User upserted in DB on first login with encrypted tokens

- [ ] **Step 1: Create NextAuth config**

Create `src/lib/auth.ts`:
```typescript
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { prisma } from './prisma'
import { encrypt } from './crypto'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/gmail.modify',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.provider !== 'google') return false
      if (!account.access_token || !account.refresh_token) return false

      await prisma.user.upsert({
        where: { email: user.email! },
        create: {
          email: user.email!,
          name: user.name ?? '',
          avatar: user.image ?? null,
          googleAccessToken: encrypt(account.access_token),
          googleRefreshToken: encrypt(account.refresh_token),
        },
        update: {
          googleAccessToken: encrypt(account.access_token),
          googleRefreshToken: encrypt(account.refresh_token),
          name: user.name ?? '',
          avatar: user.image ?? null,
        },
      })
      return true
    },
    async session({ session, token }) {
      const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email! },
        select: { id: true, syncStatus: true },
      })
      if (dbUser) {
        session.user.id = dbUser.id
      }
      return session
    },
  },
  pages: {
    signIn: '/',
  },
})
```

- [ ] **Step 2: Create the NextAuth route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 3: Extend next-auth types for session.user.id**

Create `src/types/next-auth.d.ts`:
```typescript
import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      image?: string
    }
  }
}
```

- [ ] **Step 4: Update root layout with SessionProvider**

Replace contents of `src/app/layout.tsx`:
```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { SessionProvider } from 'next-auth/react'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Gmail Cleanup',
  description: 'Clean up your Gmail inbox',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Manual smoke test**

Start dev server (`npm run dev`), visit `localhost:3000`, click "Sign in with Google", complete OAuth. Check database:

```bash
npx prisma studio
```

Expected: one User row with encrypted tokens.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/auth/ src/lib/auth.ts src/types/next-auth.d.ts src/app/layout.tsx
git commit -m "feat: add Google OAuth via NextAuth with gmail.modify scope"
```

---

## Task 5: Gmail API Client & Sync Job

**Files:**
- Create: `src/lib/gmail.ts`
- Create: `src/worker/jobs/full-sync.ts`
- Create: `src/worker/index.ts`

**Interfaces:**
- Consumes: `encrypt`, `decrypt` from `@/lib/crypto`; `prisma` from `@/lib/prisma`; `redis`, `Worker` from `@/lib/redis`; `groupMessageHeaders` from `@/lib/group-senders`; `RawMessage` from `@/types`
- Produces:
  - `createGmailClient(accessToken: string): gmail_v1.Gmail`
  - `SYNC_QUEUE = 'full-sync'` — queue name constant
  - Worker process that processes `full-sync` jobs

- [ ] **Step 1: Create Gmail client factory**

Create `src/lib/gmail.ts`:
```typescript
import { google, gmail_v1 } from 'googleapis'

export function createGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  return google.gmail({ version: 'v1', auth })
}
```

- [ ] **Step 2: Implement full-sync job**

Create `src/worker/jobs/full-sync.ts`:
```typescript
import { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { createGmailClient } from '@/lib/gmail'
import { groupMessageHeaders } from '@/lib/group-senders'
import type { RawMessage } from '@/types'

export const SYNC_QUEUE = 'full-sync'

interface SyncJobData {
  userId: string
  syncJobId: string
}

export async function processFullSync(job: Job<SyncJobData>): Promise<void> {
  const { userId, syncJobId } = job.data

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { status: 'running', startedAt: new Date() },
  })

  await prisma.user.update({
    where: { id: userId },
    data: { syncStatus: 'syncing' },
  })

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const accessToken = decrypt(user.googleAccessToken)
  const gmail = createGmailClient(accessToken)

  try {
    // Get total count estimate
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const totalEstimate = profile.data.messagesTotal ?? 0

    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: { totalEmails: totalEstimate },
    })

    // Restore cursor if resuming
    const syncJob = await prisma.syncJob.findUniqueOrThrow({ where: { id: syncJobId } })
    let pageToken: string | undefined = syncJob.pageTokenCursor ?? undefined
    let processedEmails = syncJob.processedEmails

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 500,
        pageToken,
        fields: 'messages/id,nextPageToken',
      })

      const messageIds = (listRes.data.messages ?? []).map(m => m.id!)

      // Batch fetch headers in chunks of 100
      for (let i = 0; i < messageIds.length; i += 100) {
        const chunk = messageIds.slice(i, i + 100)
        const batchRes = await gmail.users.messages.list({
          userId: 'me',
          // Use individual fetches since batchGet isn't directly in googleapis
          maxResults: 1,
        })

        // Fetch each message header individually (lightweight)
        const rawMessages: RawMessage[] = await Promise.all(
          chunk.map(async (id) => {
            const msg = await gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'metadata',
              metadataHeaders: ['From', 'List-Unsubscribe'],
            })
            const headers = msg.data.payload?.headers ?? []
            return {
              id,
              from: headers.find(h => h.name === 'From')?.value ?? '',
              listUnsubscribe: headers.find(h => h.name === 'List-Unsubscribe')?.value ?? null,
              internalDate: msg.data.internalDate ?? '0',
            }
          })
        )

        const grouped = groupMessageHeaders(rawMessages)

        for (const data of grouped) {
          await prisma.senderGroup.upsert({
            where: { userId_senderEmail: { userId, senderEmail: data.senderEmail } },
            create: { userId, ...data },
            update: {
              emailCount: { increment: data.emailCount },
              latestEmailDate: data.latestEmailDate,
              hasUnsubscribeLink: data.hasUnsubscribeLink || undefined,
              unsubscribeUrl: data.unsubscribeUrl ?? undefined,
              unsubscribeEmail: data.unsubscribeEmail ?? undefined,
            },
          })
        }

        processedEmails += chunk.length
      }

      pageToken = listRes.data.nextPageToken ?? undefined

      const progress = totalEstimate > 0
        ? Math.round((processedEmails / totalEstimate) * 100)
        : 0

      await prisma.syncJob.update({
        where: { id: syncJobId },
        data: { processedEmails, progress, pageTokenCursor: pageToken ?? null },
      })

    } while (pageToken)

    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'completed', completedAt: new Date(), progress: 100 },
    })

    await prisma.user.update({
      where: { id: userId },
      data: { syncStatus: 'idle', lastSyncedAt: new Date() },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'failed', errorMessage: message },
    })
    await prisma.user.update({
      where: { id: userId },
      data: { syncStatus: 'error' },
    })
    throw err
  }
}
```

- [ ] **Step 3: Create worker entrypoint**

Create `src/worker/index.ts`:
```typescript
import { Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { processFullSync, SYNC_QUEUE } from './jobs/full-sync'

console.log('Worker starting...')

const syncWorker = new Worker(SYNC_QUEUE, processFullSync, {
  connection: redis,
  concurrency: 2,
  limiter: { max: 10, duration: 1000 }, // 10 jobs/sec max
})

syncWorker.on('completed', job => {
  console.log(`Sync job ${job.id} completed`)
})

syncWorker.on('failed', (job, err) => {
  console.error(`Sync job ${job?.id} failed:`, err.message)
})

console.log(`Worker listening on queue: ${SYNC_QUEUE}`)
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail.ts src/worker/
git commit -m "feat: add Gmail client, full-sync worker job"
```

---

## Task 6: API Routes — Sync, Senders, Delete, Unsubscribe

**Files:**
- Create: `src/app/api/sync/route.ts`
- Create: `src/app/api/sync/status/route.ts`
- Create: `src/app/api/senders/route.ts`
- Create: `src/app/api/delete/route.ts`
- Create: `src/app/api/unsubscribe/route.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`; `prisma` from `@/lib/prisma`; `getQueue` from `@/lib/redis`; `SYNC_QUEUE` from `@/worker/jobs/full-sync`
- Produces:
  - `POST /api/sync` → `{ syncJobId: string }`
  - `GET /api/sync/status` → `SyncStatusResponse`
  - `GET /api/senders?search=&page=&limit=` → `{ senders: SenderGroup[], total: number }`
  - `POST /api/delete` body `{ senderGroupIds: string[] }` → `{ queued: number }`
  - `POST /api/unsubscribe` body `{ senderGroupId: string, deleteExisting: boolean }` → `{ ok: true }`

- [ ] **Step 1: Implement sync enqueue route**

Create `src/app/api/sync/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getQueue } from '@/lib/redis'
import { SYNC_QUEUE } from '@/worker/jobs/full-sync'

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id

  // Cancel any running sync
  await prisma.user.update({ where: { id: userId }, data: { syncStatus: 'syncing' } })

  const syncJob = await prisma.syncJob.create({
    data: { userId, status: 'queued' },
  })

  const queue = getQueue(SYNC_QUEUE)
  await queue.add('full-sync', { userId, syncJobId: syncJob.id }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  })

  return NextResponse.json({ syncJobId: syncJob.id })
}
```

- [ ] **Step 2: Implement sync status route**

Create `src/app/api/sync/status/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SyncStatusResponse } from '@/types'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { syncStatus: true },
  })

  const latestJob = await prisma.syncJob.findFirst({
    where: { userId: session.user.id },
    orderBy: { startedAt: 'desc' },
    select: { status: true, progress: true, totalEmails: true, processedEmails: true, errorMessage: true },
  })

  const response: SyncStatusResponse = {
    status: user.syncStatus,
    progress: latestJob?.progress ?? 0,
    totalEmails: latestJob?.totalEmails ?? null,
    processedEmails: latestJob?.processedEmails ?? 0,
    errorMessage: latestJob?.errorMessage ?? null,
  }

  return NextResponse.json(response)
}
```

- [ ] **Step 3: Implement senders list route**

Create `src/app/api/senders/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = parseInt(searchParams.get('limit') ?? '50', 10)
  const skip = (page - 1) * limit

  const where = {
    userId: session.user.id,
    status: { not: 'deleted' as const },
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
    prisma.senderGroup.findMany({
      where,
      orderBy: { emailCount: 'desc' },
      skip,
      take: limit,
    }),
    prisma.senderGroup.count({ where }),
  ])

  return NextResponse.json({ senders, total })
}
```

- [ ] **Step 4: Implement delete route**

Create `src/app/api/delete/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { createGmailClient } from '@/lib/gmail'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { senderGroupIds }: { senderGroupIds: string[] } = await req.json()

  if (!Array.isArray(senderGroupIds) || senderGroupIds.length === 0) {
    return NextResponse.json({ error: 'senderGroupIds required' }, { status: 400 })
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } })
  const gmail = createGmailClient(decrypt(user.googleAccessToken))

  let totalDeleted = 0

  for (const senderGroupId of senderGroupIds) {
    const group = await prisma.senderGroup.findFirst({
      where: { id: senderGroupId, userId: session.user.id },
    })
    if (!group) continue

    // Search for all messages from this sender
    let query = `from:${group.senderEmail}`
    let messageIds: string[] = []
    let nextPageToken: string | undefined

    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        pageToken: nextPageToken,
        fields: 'messages/id,nextPageToken',
      })
      messageIds.push(...(res.data.messages ?? []).map(m => m.id!))
      nextPageToken = res.data.nextPageToken ?? undefined
    } while (nextPageToken)

    // Delete in chunks of 1000
    for (let i = 0; i < messageIds.length; i += 1000) {
      const chunk = messageIds.slice(i, i + 1000)
      await gmail.users.messages.batchDelete({
        userId: 'me',
        requestBody: { ids: chunk },
      })
      totalDeleted += chunk.length
    }

    await prisma.senderGroup.update({
      where: { id: senderGroupId },
      data: { emailCount: 0, status: 'deleted' },
    })

    await prisma.deleteAction.create({
      data: {
        userId: session.user.id,
        senderGroupId,
        emailsDeleted: messageIds.length,
      },
    })
  }

  return NextResponse.json({ deleted: totalDeleted })
}
```

- [ ] **Step 5: Implement unsubscribe route**

Create `src/app/api/unsubscribe/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { createGmailClient } from '@/lib/gmail'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { senderGroupId, deleteExisting }: { senderGroupId: string; deleteExisting: boolean } =
    await req.json()

  const group = await prisma.senderGroup.findFirst({
    where: { id: senderGroupId, userId: session.user.id },
  })

  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let method: 'link' | 'email' = 'link'
  let emailsDeleted = 0

  // Unsubscribe via email if only email method available
  if (!group.unsubscribeUrl && group.unsubscribeEmail) {
    method = 'email'
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } })
    const gmail = createGmailClient(decrypt(user.googleAccessToken))

    const raw = Buffer.from(
      `To: ${group.unsubscribeEmail}\r\n` +
      `Subject: Unsubscribe\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `Please unsubscribe me from this mailing list.`
    ).toString('base64url')

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    })
  }

  // Optionally delete existing emails
  if (deleteExisting) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } })
    const gmail = createGmailClient(decrypt(user.googleAccessToken))

    let messageIds: string[] = []
    let nextPageToken: string | undefined

    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: `from:${group.senderEmail}`,
        maxResults: 500,
        pageToken: nextPageToken,
        fields: 'messages/id,nextPageToken',
      })
      messageIds.push(...(res.data.messages ?? []).map(m => m.id!))
      nextPageToken = res.data.nextPageToken ?? undefined
    } while (nextPageToken)

    for (let i = 0; i < messageIds.length; i += 1000) {
      await gmail.users.messages.batchDelete({
        userId: 'me',
        requestBody: { ids: messageIds.slice(i, i + 1000) },
      })
    }

    emailsDeleted = messageIds.length

    await prisma.senderGroup.update({
      where: { id: senderGroupId },
      data: { emailCount: 0 },
    })
  }

  await prisma.senderGroup.update({
    where: { id: senderGroupId },
    data: { status: 'unsubscribed' },
  })

  await prisma.unsubscribeAction.create({
    data: {
      userId: session.user.id,
      senderGroupId,
      method,
      deleteExisting,
      emailsDeleted,
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/
git commit -m "feat: add sync, senders, delete, and unsubscribe API routes"
```

---

## Task 7: Landing Page UI

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `signIn` from `next-auth/react`
- Produces: Landing page at `/` with "Sign in with Google" button; redirects to `/dashboard` after auth

- [ ] **Step 1: Replace landing page**

Replace `src/app/page.tsx`:
```typescript
'use client'

import { signIn } from 'next-auth/react'

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-auto p-8 bg-white rounded-2xl shadow-sm border border-gray-100 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Gmail Cleanup</h1>
        <p className="text-gray-500 mb-8">
          Unsubscribe from mailing lists and bulk delete emails — fast.
        </p>
        <button
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Sign in with Google
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Verify dev server renders landing page correctly**

```bash
npm run dev
```

Visit `localhost:3000`. Expected: centered card with "Gmail Cleanup" heading and Google sign-in button.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add landing page with Google sign-in button"
```

---

## Task 8: Dashboard UI — Sender List & Header

**Files:**
- Create: `src/app/dashboard/layout.tsx`
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/dashboard/_components/sync-status.tsx`
- Create: `src/app/dashboard/_components/sender-row.tsx`
- Create: `src/app/dashboard/_components/sender-list.tsx`

**Interfaces:**
- Consumes: `GET /api/senders`, `GET /api/sync/status`, `POST /api/sync`
- Produces: Dashboard at `/dashboard` showing sender list sorted by email count, sync status header, search bar

- [ ] **Step 1: Create sync-status component**

Create `src/app/dashboard/_components/sync-status.tsx`:
```typescript
'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SyncStatusResponse } from '@/types'

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null)

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/sync/status')
    if (res.ok) setStatus(await res.json())
  }, [])

  const triggerSync = async () => {
    await fetch('/api/sync', { method: 'POST' })
    fetchStatus()
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  if (!status) return null

  const isSyncing = status.status === 'syncing'
  const isError = status.status === 'error'

  return (
    <div className="flex items-center gap-3">
      {isSyncing && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
          <span>
            Syncing{status.totalEmails
              ? ` ${status.processedEmails.toLocaleString()} / ${status.totalEmails.toLocaleString()}`
              : '...'}
          </span>
          <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        </div>
      )}

      {isError && (
        <span className="text-sm text-red-600">
          Sync failed — {status.errorMessage}
        </span>
      )}

      {!isSyncing && (
        <button
          onClick={triggerSync}
          className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
        >
          {isError ? 'Retry sync' : 'Re-sync'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create sender-row component**

Create `src/app/dashboard/_components/sender-row.tsx`:
```typescript
'use client'

import type { SenderGroup } from '@prisma/client'

interface SenderRowProps {
  sender: SenderGroup
  selected: boolean
  onSelect: (id: string, checked: boolean) => void
  onUnsubscribe: (sender: SenderGroup) => void
  onDelete: (sender: SenderGroup) => void
}

export function SenderRow({ sender, selected, onSelect, onUnsubscribe, onDelete }: SenderRowProps) {
  const isUnsubscribed = sender.status === 'unsubscribed'

  return (
    <div className={`flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selected ? 'bg-blue-50' : ''}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={e => onSelect(sender.id, e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-blue-600"
      />

      <div className="flex-1 min-w-0">
        <div className={`font-medium text-gray-900 truncate ${isUnsubscribed ? 'line-through text-gray-400' : ''}`}>
          {sender.senderName}
        </div>
        <div className="text-sm text-gray-500 truncate">{sender.senderEmail}</div>
      </div>

      <div className="text-sm text-gray-500 whitespace-nowrap">
        <span className="font-medium text-gray-700">{sender.emailCount.toLocaleString()}</span> emails
      </div>

      {isUnsubscribed && (
        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Unsubscribed</span>
      )}

      {!isUnsubscribed && sender.hasUnsubscribeLink && (
        <button
          onClick={() => onUnsubscribe(sender)}
          className="text-sm px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap"
        >
          Unsubscribe
        </button>
      )}

      <button
        onClick={() => onDelete(sender)}
        className="text-sm px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
      >
        Delete all
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create sender-list component**

Create `src/app/dashboard/_components/sender-list.tsx`:
```typescript
'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SenderGroup } from '@prisma/client'
import { SenderRow } from './sender-row'

interface SenderListProps {
  search: string
  selectedIds: Set<string>
  onSelect: (id: string, checked: boolean) => void
  onUnsubscribe: (sender: SenderGroup) => void
  onDelete: (sender: SenderGroup) => void
}

export function SenderList({ search, selectedIds, onSelect, onUnsubscribe, onDelete }: SenderListProps) {
  const [senders, setSenders] = useState<SenderGroup[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchSenders = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ search, page: String(page), limit: '50' })
    const res = await fetch(`/api/senders?${params}`)
    if (res.ok) {
      const data = await res.json()
      setSenders(data.senders)
      setTotal(data.total)
    }
    setLoading(false)
  }, [search, page])

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    fetchSenders()
  }, [fetchSenders])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        Loading senders...
      </div>
    )
  }

  if (senders.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        {search ? 'No senders match your search.' : 'No senders found. Run a sync first.'}
      </div>
    )
  }

  return (
    <div>
      <div className="text-sm text-gray-500 px-4 py-2 border-b border-gray-100">
        {total.toLocaleString()} senders
      </div>
      {senders.map(sender => (
        <SenderRow
          key={sender.id}
          sender={sender}
          selected={selectedIds.has(sender.id)}
          onSelect={onSelect}
          onUnsubscribe={onUnsubscribe}
          onDelete={onDelete}
        />
      ))}
      {total > 50 && (
        <div className="flex items-center justify-center gap-4 p-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page} of {Math.ceil(total / 50)}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create dashboard layout**

Create `src/app/dashboard/layout.tsx`:
```typescript
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { SyncStatus } from './_components/sync-status'
import Image from 'next/image'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-gray-900">Gmail Cleanup</h1>
          <SyncStatus />
          <div className="flex items-center gap-2">
            {session.user.image && (
              <Image
                src={session.user.image}
                alt={session.user.name}
                width={32}
                height={32}
                className="rounded-full"
              />
            )}
            <span className="text-sm text-gray-700 hidden sm:block">{session.user.name}</span>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto py-6 px-4">{children}</main>
    </div>
  )
}
```

- [ ] **Step 5: Create dashboard page (stub — modals in next task)**

Create `src/app/dashboard/page.tsx`:
```typescript
'use client'

import { useState } from 'react'
import type { SenderGroup } from '@prisma/client'
import { SenderList } from './_components/sender-list'

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  const handleUnsubscribe = (sender: SenderGroup) => {
    // Implemented in Task 9
    console.log('unsubscribe', sender.id)
  }

  const handleDelete = (sender: SenderGroup) => {
    // Implemented in Task 9
    console.log('delete', sender.id)
  }

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search senders..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <SenderList
          search={search}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onUnsubscribe={handleUnsubscribe}
          onDelete={handleDelete}
        />
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 text-sm">
          <span>{selectedIds.size} selected</span>
          <button
            onClick={() => {
              // Implemented in Task 9
              console.log('bulk delete', [...selectedIds])
            }}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 rounded-full transition-colors"
          >
            Delete all
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verify dev server renders dashboard after sign-in**

Sign in via Google, visit `localhost:3000/dashboard`. Expected: header with sync status, search bar, empty sender list with "No senders found. Run a sync first."

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/
git commit -m "feat: add dashboard UI — sender list, sync status header"
```

---

## Task 9: Unsubscribe & Delete Modals

**Files:**
- Create: `src/app/dashboard/_components/unsubscribe-modal.tsx`
- Create: `src/app/dashboard/_components/delete-confirm-modal.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `POST /api/unsubscribe`, `POST /api/delete`
- Produces: Fully working unsubscribe flow with delete option, bulk delete confirmation modal

- [ ] **Step 1: Create unsubscribe modal**

Create `src/app/dashboard/_components/unsubscribe-modal.tsx`:
```typescript
'use client'

import { useState } from 'react'
import type { SenderGroup } from '@prisma/client'

interface UnsubscribeModalProps {
  sender: SenderGroup
  onClose: () => void
  onSuccess: (senderGroupId: string, deleted: boolean) => void
}

export function UnsubscribeModal({ sender, onClose, onSuccess }: UnsubscribeModalProps) {
  const [step, setStep] = useState<'confirm' | 'opened-link' | 'loading'>('confirm')
  const [deleteExisting, setDeleteExisting] = useState(false)

  const handleUnsubscribeViaLink = () => {
    window.open(sender.unsubscribeUrl!, '_blank')
    setStep('opened-link')
  }

  const handleConfirmDone = async () => {
    setStep('loading')
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderGroupId: sender.id, deleteExisting }),
    })
    onSuccess(sender.id, deleteExisting)
    onClose()
  }

  const handleUnsubscribeViaEmail = async () => {
    setStep('loading')
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderGroupId: sender.id, deleteExisting }),
    })
    onSuccess(sender.id, deleteExisting)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Unsubscribe from {sender.senderName}
        </h2>
        <p className="text-sm text-gray-500 mb-6">{sender.senderEmail}</p>

        {step === 'confirm' && (
          <>
            <div className="mb-6 p-4 bg-gray-50 rounded-xl">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteExisting}
                  onChange={e => setDeleteExisting(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Also delete {sender.emailCount.toLocaleString()} existing emails
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Permanently removes all emails from this sender
                  </div>
                </div>
              </label>
            </div>

            {sender.unsubscribeUrl && (
              <button
                onClick={handleUnsubscribeViaLink}
                className="w-full mb-3 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
              >
                Open unsubscribe page
              </button>
            )}

            {!sender.unsubscribeUrl && sender.unsubscribeEmail && (
              <button
                onClick={handleUnsubscribeViaEmail}
                className="w-full mb-3 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
              >
                Send unsubscribe email
              </button>
            )}

            <button onClick={onClose} className="w-full px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
              Cancel
            </button>
          </>
        )}

        {step === 'opened-link' && (
          <>
            <p className="text-sm text-gray-600 mb-6">
              Complete the unsubscribe on the page that opened in your browser, then click below.
            </p>
            {deleteExisting && (
              <p className="text-xs text-gray-500 mb-4">
                {sender.emailCount.toLocaleString()} existing emails will also be deleted.
              </p>
            )}
            <button
              onClick={handleConfirmDone}
              className="w-full mb-3 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors"
            >
              I've unsubscribed
            </button>
            <button onClick={onClose} className="w-full px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
              Cancel
            </button>
          </>
        )}

        {step === 'loading' && (
          <div className="flex items-center justify-center py-8 text-gray-500">
            Processing...
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create delete confirmation modal**

Create `src/app/dashboard/_components/delete-confirm-modal.tsx`:
```typescript
'use client'

import { useState } from 'react'

interface DeleteConfirmModalProps {
  senderIds: string[]
  senderNames: string[]
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DeleteConfirmModal({ senderIds, senderNames, onClose, onConfirm }: DeleteConfirmModalProps) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete all emails?</h2>
        <p className="text-sm text-gray-500 mb-4">
          This will permanently delete all emails from {senderIds.length === 1
            ? senderNames[0]
            : `${senderIds.length} senders`}. This cannot be undone.
        </p>

        {senderIds.length > 1 && senderNames.length > 0 && (
          <ul className="mb-4 text-sm text-gray-600 max-h-32 overflow-y-auto space-y-1">
            {senderNames.slice(0, 5).map(name => (
              <li key={name} className="truncate">• {name}</li>
            ))}
            {senderNames.length > 5 && (
              <li className="text-gray-400">...and {senderNames.length - 5} more</li>
            )}
          </ul>
        )}

        <button
          onClick={handleConfirm}
          disabled={loading}
          className="w-full mb-3 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl font-medium transition-colors"
        >
          {loading ? 'Deleting...' : 'Yes, delete all'}
        </button>
        <button
          onClick={onClose}
          disabled={loading}
          className="w-full px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire modals into dashboard page**

Replace `src/app/dashboard/page.tsx`:
```typescript
'use client'

import { useState, useCallback } from 'react'
import type { SenderGroup } from '@prisma/client'
import { SenderList } from './_components/sender-list'
import { UnsubscribeModal } from './_components/unsubscribe-modal'
import { DeleteConfirmModal } from './_components/delete-confirm-modal'

export default function DashboardPage() {
  const [search, setSearch] = useState('')
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
    setDeleteTarget({
      ids: [...selectedIds],
      names: [...selectedNames.values()],
    })
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

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search senders..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <SenderList
          key={refreshKey}
          search={search}
          selectedIds={selectedIds}
          onSelect={(sender, checked) => handleSelect(sender, checked)}
          onUnsubscribe={setUnsubscribeSender}
          onDelete={handleDeleteSingle}
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
            onClick={() => { setSelectedIds(new Set()); setSelectedNames(new Map()) }}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
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

Note: update `sender-list.tsx` to pass the full sender object to `onSelect`:

In `src/app/dashboard/_components/sender-list.tsx`, change the `SenderListProps` interface:
```typescript
interface SenderListProps {
  search: string
  selectedIds: Set<string>
  onSelect: (sender: SenderGroup, checked: boolean) => void  // changed
  onUnsubscribe: (sender: SenderGroup) => void
  onDelete: (sender: SenderGroup) => void
}
```

And in `SenderRow` in `sender-row.tsx`, update the `onSelect` prop type to `(id: string, checked: boolean) => void` (keep as-is — the SenderList wraps and passes the sender object up).

Actually, update `SenderList` to pass the full sender to `onSelect`:
```typescript
// In sender-list.tsx, update SenderRow usage:
<SenderRow
  key={sender.id}
  sender={sender}
  selected={selectedIds.has(sender.id)}
  onSelect={(id, checked) => onSelect(sender, checked)}   // ← wrap here
  onUnsubscribe={onUnsubscribe}
  onDelete={onDelete}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual E2E smoke test**

1. Sign in, trigger a sync via "Re-sync" button
2. Once senders populate, click "Unsubscribe" on a sender with a link — verify modal opens, link opens in new tab, "I've unsubscribed" updates the row
3. Click "Delete all" on a sender — verify confirmation modal, confirm, row disappears
4. Select multiple senders via checkboxes — verify bulk action bar appears and bulk delete works

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/
git commit -m "feat: add unsubscribe and delete modals, wire up all actions"
```

---

## Task 10: Auto-Sync on First Login

**Files:**
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Consumes: `getQueue` from `@/lib/redis`; `SYNC_QUEUE` from `@/worker/jobs/full-sync`
- Produces: On first login (new user), a full-sync job is automatically enqueued

- [ ] **Step 1: Enqueue sync job on first sign-in**

In `src/lib/auth.ts`, update the `signIn` callback to detect first-time users and enqueue a sync:

```typescript
// Add import at top:
import { getQueue } from './redis'
import { SYNC_QUEUE } from '@/worker/jobs/full-sync'

// In signIn callback, after the upsert:
async signIn({ user, account }) {
  if (!account || account.provider !== 'google') return false
  if (!account.access_token || !account.refresh_token) return false

  const existing = await prisma.user.findUnique({ where: { email: user.email! } })

  const dbUser = await prisma.user.upsert({
    where: { email: user.email! },
    create: {
      email: user.email!,
      name: user.name ?? '',
      avatar: user.image ?? null,
      googleAccessToken: encrypt(account.access_token),
      googleRefreshToken: encrypt(account.refresh_token),
    },
    update: {
      googleAccessToken: encrypt(account.access_token),
      googleRefreshToken: encrypt(account.refresh_token),
      name: user.name ?? '',
      avatar: user.image ?? null,
    },
  })

  // Enqueue sync for new users only
  if (!existing) {
    const syncJob = await prisma.syncJob.create({
      data: { userId: dbUser.id, status: 'queued' },
    })
    const queue = getQueue(SYNC_QUEUE)
    await queue.add('full-sync', { userId: dbUser.id, syncJobId: syncJob.id }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    })
  }

  return true
},
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual test**

Create a fresh user (use a new incognito window or clear the DB user row). Sign in. Expected: sync job appears immediately in the worker logs without clicking Re-sync.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: auto-enqueue full sync on first login"
```

---

## Task 11: Playwright E2E Tests

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/landing.spec.ts`
- Create: `e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: running Next.js dev server on port 3000
- Produces: E2E test suite covering landing page, dashboard render, unsubscribe modal, delete confirmation modal

- [ ] **Step 1: Initialize Playwright**

```bash
npx playwright install --with-deps chromium
```

- [ ] **Step 2: Create Playwright config**

Create `playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

- [ ] **Step 3: Write landing page E2E test**

Create `e2e/landing.spec.ts`:
```typescript
import { test, expect } from '@playwright/test'

test('landing page shows sign-in button', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Gmail Cleanup' })).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible()
})

test('unauthenticated user is redirected from /dashboard to /', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL('/')
})
```

- [ ] **Step 4: Run landing page tests**

```bash
npx playwright test e2e/landing.spec.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Write dashboard modal E2E tests (mocked auth)**

Create `e2e/dashboard.spec.ts`:
```typescript
import { test, expect } from '@playwright/test'

// These tests mock the auth session and API responses to avoid real Gmail
// Set up: mock /api/auth/session to return a valid session,
// and mock /api/senders and /api/sync/status

test.beforeEach(async ({ page }) => {
  // Mock NextAuth session
  await page.route('**/api/auth/session', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'test-user', email: 'test@example.com', name: 'Test User' },
        expires: '2099-01-01',
      }),
    })
  )

  // Mock sync status — idle
  await page.route('**/api/sync/status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'idle',
        progress: 0,
        totalEmails: null,
        processedEmails: 0,
        errorMessage: null,
      }),
    })
  )

  // Mock sender list
  await page.route('**/api/senders**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 2,
        senders: [
          {
            id: 'sender-1',
            userId: 'test-user',
            senderEmail: 'news@example.com',
            senderName: 'Example Newsletter',
            emailCount: 142,
            latestEmailDate: '2026-07-01T00:00:00Z',
            hasUnsubscribeLink: true,
            unsubscribeUrl: 'https://example.com/unsub',
            unsubscribeEmail: null,
            status: 'active',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-07-01T00:00:00Z',
          },
          {
            id: 'sender-2',
            userId: 'test-user',
            senderEmail: 'promo@store.com',
            senderName: 'Store Promos',
            emailCount: 87,
            latestEmailDate: '2026-06-15T00:00:00Z',
            hasUnsubscribeLink: false,
            unsubscribeUrl: null,
            unsubscribeEmail: null,
            status: 'active',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-06-15T00:00:00Z',
          },
        ],
      }),
    })
  )
})

test('dashboard shows sender list', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByText('Example Newsletter')).toBeVisible()
  await expect(page.getByText('Store Promos')).toBeVisible()
})

test('unsubscribe button only shown for senders with link', async ({ page }) => {
  await page.goto('/dashboard')
  const rows = page.locator('[data-testid="sender-row"]')
  // sender-1 has unsubscribe link
  await expect(rows.first().getByRole('button', { name: /unsubscribe/i })).toBeVisible()
  // sender-2 has no unsubscribe link
  await expect(rows.nth(1).getByRole('button', { name: /unsubscribe/i })).not.toBeVisible()
})

test('unsubscribe modal opens and shows delete option', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /unsubscribe/i }).first().click()
  await expect(page.getByText('Unsubscribe from Example Newsletter')).toBeVisible()
  await expect(page.getByText(/also delete 142 existing emails/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /open unsubscribe page/i })).toBeVisible()
})

test('bulk action bar appears when sender selected', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('checkbox').first().check()
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect(page.getByRole('button', { name: /delete all/i })).toBeVisible()
})

test('delete confirm modal appears on delete', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /delete all/i }).first().click()
  await expect(page.getByText(/delete all emails\?/i)).toBeVisible()
  await expect(page.getByText(/this cannot be undone/i)).toBeVisible()
})
```

Note: add `data-testid="sender-row"` to the outer div in `sender-row.tsx`:
```typescript
// In src/app/dashboard/_components/sender-row.tsx, change the outer div:
<div data-testid="sender-row" className={`flex items-center gap-4 ...`}>
```

- [ ] **Step 6: Run E2E tests**

```bash
npx playwright test e2e/dashboard.spec.ts
```

Expected: 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/ src/app/dashboard/_components/sender-row.tsx
git commit -m "test: add Playwright E2E tests for landing page and dashboard"
```

---

## Task 12: Railway Deployment Configuration

**Files:**
- Create: `railway.toml`
- Create: `Procfile`

**Interfaces:**
- Produces: Railway-deployable configuration for web and worker services

- [ ] **Step 1: Create railway.toml**

Create `railway.toml`:
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run start"
healthcheckPath = "/api/health"
healthcheckTimeout = 30

[[services]]
name = "web"
startCommand = "npm run start"

[[services]]
name = "worker"
startCommand = "npm run worker"
```

- [ ] **Step 2: Add health check endpoint**

Create `src/app/api/health/route.ts`:
```typescript
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Add production build script to package.json**

Ensure `package.json` has:
```json
"scripts": {
  "build": "next build",
  "start": "next start",
  "worker": "tsx src/worker/index.ts",
  "dev": "next dev"
}
```

- [ ] **Step 4: Add Prisma generate to build**

Update `build` script to run Prisma generate before building:
```json
"build": "prisma generate && next build"
```

- [ ] **Step 5: Verify production build completes**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add railway.toml src/app/api/health/ package.json
git commit -m "feat: add Railway deployment config and health check endpoint"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Google OAuth with `gmail.modify` scope → Task 4
- [x] Multi-user support → Task 4 (user upsert), Task 6 (auth guards)
- [x] Full sync with BullMQ background job → Task 5
- [x] Sync progress polling every 3 seconds → Task 8 (SyncStatus component)
- [x] Checkpoint/resume on sync failure → Task 5 (pageTokenCursor)
- [x] Group by sender, sorted by email count → Task 6 (senders route), Task 8
- [x] Unsubscribe via link (new tab + confirm) → Task 9
- [x] Unsubscribe via email (Gmail API send) → Task 6 (unsubscribe route)
- [x] Delete existing on unsubscribe (user choice) → Task 9
- [x] Bulk delete in chunks of 1000 → Task 6 (delete route)
- [x] Bulk select + bulk delete → Task 9
- [x] Search filter by sender name/email → Task 6 (senders route), Task 8
- [x] Sync auto-enqueue on first login → Task 10
- [x] Re-sync button → Task 8 (SyncStatus)
- [x] Token encryption → Task 3 (crypto), Task 4 (stored encrypted)
- [x] BullMQ retry with exponential backoff (429) → Task 6 (sync route add options)
- [x] Error state: syncStatus error, reconnect prompt → Task 8 (SyncStatus)
- [x] Unit tests for parsing and grouping → Task 3
- [x] E2E tests → Task 11
- [x] Railway deployment → Task 12
- [x] Landing page → Task 7

**Missing from spec, added:**
- Health check endpoint (needed by Railway) → Task 12
- `data-testid` attributes for E2E selectors → Task 11
- `pageTokenCursor` column in `SyncJob` for checkpoint/resume → Task 2 schema
