import { describe, it, expect } from 'vitest'
import { classifyByDomain, CATEGORY_PRIORITY } from '../classify-sender'

describe('classifyByDomain', () => {
  it('classifies uber.com as ridesharing', () => {
    expect(classifyByDomain('driver@uber.com', false)).toBe('ridesharing')
  })

  it('classifies subdomain of uber.com as ridesharing', () => {
    expect(classifyByDomain('noreply@notifications.uber.com', false)).toBe('ridesharing')
  })

  it('classifies ifood.com.br as food', () => {
    expect(classifyByDomain('noreply@ifood.com.br', false)).toBe('food')
  })

  it('classifies amazon.com as receipts', () => {
    expect(classifyByDomain('order@amazon.com', false)).toBe('receipts')
  })

  it('classifies amazon.com.br as receipts', () => {
    expect(classifyByDomain('order@amazon.com.br', false)).toBe('receipts')
  })

  it('returns newsletters when hasUnsubscribeLink is true and no domain match', () => {
    expect(classifyByDomain('news@unknown-newsletter.com', true)).toBe('newsletters')
  })

  it('returns null for unknown domain without unsubscribe link', () => {
    expect(classifyByDomain('hello@someperson.com', false)).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(classifyByDomain('noreply@UBER.COM', false)).toBe('ridesharing')
  })

  it('ridesharing takes priority over newsletters', () => {
    expect(classifyByDomain('noreply@uber.com', true)).toBe('ridesharing')
  })
})

describe('CATEGORY_PRIORITY', () => {
  it('starts with ridesharing', () => {
    expect(CATEGORY_PRIORITY[0]).toBe('ridesharing')
  })

  it('ends with largemail', () => {
    expect(CATEGORY_PRIORITY[CATEGORY_PRIORITY.length - 1]).toBe('largemail')
  })
})
