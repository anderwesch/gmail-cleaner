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

  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } })
    const gmail = createGmailClient(decrypt(user.googleAccessToken))

    let totalDeleted = 0

    for (const senderGroupId of senderGroupIds) {
      const group = await prisma.senderGroup.findFirst({
        where: { id: senderGroupId, userId: session.user.id },
      })
      if (!group) continue

      // Search for all messages from this sender
      const query = `from:${group.senderEmail}`
      const messageIds: string[] = []
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

    return NextResponse.json({ queued: totalDeleted })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
