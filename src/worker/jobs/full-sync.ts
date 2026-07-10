import { Job } from 'bullmq'
import pLimit from 'p-limit'
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
    const accessToken = decrypt(user.googleAccessToken)
    const gmail = createGmailClient(accessToken)

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
