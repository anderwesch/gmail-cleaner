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
