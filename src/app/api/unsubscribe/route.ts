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

  if (!senderGroupId || typeof senderGroupId !== 'string' || typeof deleteExisting !== 'boolean') {
    return NextResponse.json({ error: 'senderGroupId (string) and deleteExisting (boolean) required' }, { status: 400 })
  }

  const group = await prisma.senderGroup.findFirst({
    where: { id: senderGroupId, userId: session.user.id },
  })

  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    let method: 'link' | 'email' = 'link'
    let emailsDeleted = 0

    const needsGmail = (!group.unsubscribeUrl && !!group.unsubscribeEmail) || deleteExisting
    let gmail: ReturnType<typeof createGmailClient> | undefined

    if (needsGmail) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } })
      gmail = createGmailClient(decrypt(user.googleAccessToken))
    }

    // Unsubscribe via email if only email method available
    if (!group.unsubscribeUrl && group.unsubscribeEmail) {
      method = 'email'

      const raw = Buffer.from(
        `To: ${group.unsubscribeEmail}\r\n` +
        `Subject: Unsubscribe\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `Please unsubscribe me from this mailing list.`
      ).toString('base64url')

      await gmail!.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      })
    }

    // Optionally delete existing emails
    if (deleteExisting) {
      const messageIds: string[] = []
      let nextPageToken: string | undefined

      do {
        const res = await gmail!.users.messages.list({
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
        await gmail!.users.messages.batchDelete({
          userId: 'me',
          requestBody: { ids: messageIds.slice(i, i + 1000) },
        })
      }

      emailsDeleted = messageIds.length

      await prisma.senderGroup.update({
        where: { id: senderGroupId },
        data: { emailCount: 0 },
      })

      await prisma.deleteAction.create({
        data: {
          userId: session.user.id,
          senderGroupId,
          emailsDeleted,
        },
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
