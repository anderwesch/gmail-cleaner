import { Job } from 'bullmq'
import pLimit from 'p-limit'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { decrypt, encrypt } from '@/lib/crypto'
import { groupMessageHeaders } from '@/lib/group-senders'
import { classifyByDomain, CATEGORY_PRIORITY } from '@/lib/classify-sender'
import type { RawMessage } from '@/types'

export const SYNC_QUEUE = 'full-sync'

interface SyncJobData {
  userId: string
  syncJobId: string
}

export async function processFullSync(job: Job<SyncJobData>): Promise<void> {
  const { userId, syncJobId } = job.data

  try {
    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'running', startedAt: new Date() },
    })

    await prisma.user.update({
      where: { id: userId },
      data: { syncStatus: 'syncing' },
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    // Set up OAuth2 client and refresh the access token
    const oAuth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    )
    oAuth2.setCredentials({
      access_token: decrypt(user.googleAccessToken),
      refresh_token: decrypt(user.googleRefreshToken),
    })

    // Get a fresh token (refreshes automatically if expired)
    const { credentials } = await oAuth2.refreshAccessToken()
    const freshAccessToken = credentials.access_token!

    // Persist refreshed tokens
    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: encrypt(freshAccessToken),
        ...(credentials.refresh_token ? { googleRefreshToken: encrypt(credentials.refresh_token) } : {}),
      },
    })

    // Use the oauth2 client directly for Gmail
    const gmail = google.gmail({ version: 'v1', auth: oAuth2 })

    // Get total count estimate
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const totalEstimate = profile.data.messagesTotal ?? 0

    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: { totalEmails: totalEstimate },
    })

    // Reset counts before re-sync so increments are accurate
    await prisma.senderGroup.updateMany({
      where: { userId },
      data: { emailCount: 0 },
    })

    // Restore cursor if resuming
    const syncJob = await prisma.syncJob.findUniqueOrThrow({ where: { id: syncJobId } })
    let pageToken: string | undefined = syncJob.pageTokenCursor ?? undefined
    let processedEmails = syncJob.processedEmails

    const limit = pLimit(10)

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 500,
        pageToken,
        fields: 'messages/id,nextPageToken',
      })

      const messageIds = (listRes.data.messages ?? []).map(m => m.id!)

      // Fetch each message header individually in chunks of 100
      for (let i = 0; i < messageIds.length; i += 100) {
        const chunk = messageIds.slice(i, i + 100)

        const rawMessages: RawMessage[] = await Promise.all(
          chunk.map(id => limit(async () => {
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
          }))
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

    // --- Classification pass ---
    // Fetch all senders for this user
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
            { q: `from:${sender.senderEmail} category:social`, cat: 'social' },
            { q: `from:${sender.senderEmail} category:updates`, cat: 'updates' },
            { q: `from:${sender.senderEmail} category:promotions`, cat: 'promotions' },
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
