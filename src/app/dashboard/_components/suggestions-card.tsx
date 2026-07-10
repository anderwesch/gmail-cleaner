'use client'

import { useEffect, useState } from 'react'
import type { SenderCategory } from '@prisma/client'

const CATEGORY_EMOJI: Record<SenderCategory, string> = {
  newsletters: '📧',
  promotions: '🏷️',
  social: '💬',
  updates: '🔔',
  ridesharing: '🚗',
  food: '🍔',
  receipts: '📦',
  oldmail: '⏰',
  largemail: '📎',
}

interface Suggestion {
  category: SenderCategory
  label: string
  totalEmails: number
  topSenders: string[]
  senderCount: number
}

interface SuggestionsCardProps {
  onCategorySelect: (category: string) => void
  syncKey: number
}

const DISMISSED_KEY = 'dismissed-suggestions'

function getDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
  } catch {
    return []
  }
}

function setDismissed(cats: string[]) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(cats))
}

export function SuggestionsCard({ onCategorySelect, syncKey }: SuggestionsCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [dismissed, setDismissedState] = useState<string[]>(getDismissed)

  useEffect(() => {
    // Reset dismissed on new sync
    setDismissed([])
    setDismissedState([])
  }, [syncKey])

  useEffect(() => {
    fetch('/api/suggestions')
      .then(r => r.ok ? r.json() : { suggestions: [] })
      .then(data => setSuggestions(data.suggestions ?? []))
      .catch(() => setSuggestions([]))
  }, [syncKey])

  const visible = suggestions.filter(s => !dismissed.includes(s.category))

  if (visible.length === 0) return null

  const handleDismiss = (category: string) => {
    const next = [...dismissed, category]
    setDismissed(next)
    setDismissedState(next)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">✨ Quick Wins</h2>
      <div className="space-y-2">
        {visible.map(s => (
          <div key={s.category} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
            <span className="text-xl">{CATEGORY_EMOJI[s.category]}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900">{s.label}</div>
              <div className="text-xs text-gray-500">
                {s.totalEmails.toLocaleString()} emails · {s.topSenders.slice(0, 3).join(', ')}
                {s.senderCount > 3 ? ` +${s.senderCount - 3} more` : ''}
              </div>
            </div>
            <button
              onClick={() => onCategorySelect(s.category)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              Clean up
            </button>
            <button
              onClick={() => handleDismiss(s.category)}
              className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
