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
