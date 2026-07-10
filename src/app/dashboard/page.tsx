'use client'

import { useState } from 'react'
import type { SenderGroup } from '@prisma/client'
import { SenderList } from './_components/sender-list'

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleSelect = (sender: SenderGroup, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      checked ? next.add(sender.id) : next.delete(sender.id)
      return next
    })
  }

  const handleUnsubscribe = (sender: SenderGroup) => {
    // Implemented in Task 9
    console.log('unsubscribe', sender.id)
  }

  const handleDelete = (sender: SenderGroup) => {
    // Implemented in Task 9
    console.log('delete', sender.id)
  }

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search senders..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <SenderList
          search={search}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onUnsubscribe={handleUnsubscribe}
          onDelete={handleDelete}
        />
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 text-sm">
          <span>{selectedIds.size} selected</span>
          <button
            onClick={() => {
              // Implemented in Task 9
              console.log('bulk delete', [...selectedIds])
            }}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 rounded-full transition-colors"
          >
            Delete all
          </button>
        </div>
      )}
    </div>
  )
}
