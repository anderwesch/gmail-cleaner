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
