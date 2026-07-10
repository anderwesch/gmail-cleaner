'use client'

import { useEffect, useState } from 'react'
import type { SenderCategory } from '@prisma/client'

const CATEGORY_CONFIG: { key: SenderCategory | 'all'; label: string; emoji: string }[] = [
  { key: 'all', label: 'All', emoji: '' },
  { key: 'newsletters', label: 'Newsletters', emoji: '📧' },
  { key: 'promotions', label: 'Promotions', emoji: '🏷️' },
  { key: 'receipts', label: 'Receipts', emoji: '📦' },
  { key: 'food', label: 'Food Delivery', emoji: '🍔' },
  { key: 'ridesharing', label: 'Ride Sharing', emoji: '🚗' },
  { key: 'social', label: 'Social', emoji: '💬' },
  { key: 'updates', label: 'Updates', emoji: '🔔' },
  { key: 'oldmail', label: 'Old Mail', emoji: '⏰' },
  { key: 'largemail', label: 'Large Mail', emoji: '📎' },
]

interface CategoryTabsProps {
  activeCategory: string
  onChange: (category: string) => void
}

export function CategoryTabs({ activeCategory, onChange }: CategoryTabsProps) {
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    async function fetchCounts() {
      // Fetch total count (for "All" tab)
      const allRes = await fetch('/api/senders?limit=1')
      if (allRes.ok) {
        const data = await allRes.json()
        setCounts(prev => ({ ...prev, all: data.total }))
      }

      // Fetch per-category counts by querying each
      await Promise.all(
        CATEGORY_CONFIG.filter(c => c.key !== 'all').map(async c => {
          const res = await fetch(`/api/senders?category=${c.key}&limit=1`)
          if (res.ok) {
            const data = await res.json()
            setCounts(prev => ({ ...prev, [c.key]: data.total }))
          }
        })
      )
    }
    fetchCounts()
  }, [])

  const visibleTabs = CATEGORY_CONFIG.filter(
    c => c.key === 'all' || (counts[c.key] ?? 0) > 0
  )

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
      {visibleTabs.map(tab => {
        const isActive = activeCategory === tab.key
        const count = counts[tab.key]
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab.emoji && <span>{tab.emoji}</span>}
            <span>{tab.label}</span>
            {count !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-blue-500 text-blue-100' : 'bg-gray-200 text-gray-600'
              }`}>
                {count.toLocaleString()}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
