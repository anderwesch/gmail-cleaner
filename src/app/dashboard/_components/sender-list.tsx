'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SenderGroup } from '@prisma/client'
import { SenderRow } from './sender-row'

interface SenderListProps {
  search: string
  selectedIds: Set<string>
  onSelect: (sender: SenderGroup, checked: boolean) => void
  onUnsubscribe: (sender: SenderGroup) => void
  onDelete: (sender: SenderGroup) => void
}

export function SenderList({ search, selectedIds, onSelect, onUnsubscribe, onDelete }: SenderListProps) {
  const [senders, setSenders] = useState<SenderGroup[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchSenders = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ search, page: String(page), limit: '50' })
    const res = await fetch(`/api/senders?${params}`)
    if (res.ok) {
      const data = await res.json()
      setSenders(data.senders)
      setTotal(data.total)
    }
    setLoading(false)
  }, [search, page])

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    fetchSenders()
  }, [fetchSenders])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        Loading senders...
      </div>
    )
  }

  if (senders.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        {search ? 'No senders match your search.' : 'No senders found. Run a sync first.'}
      </div>
    )
  }

  return (
    <div>
      <div className="text-sm text-gray-500 px-4 py-2 border-b border-gray-100">
        {total.toLocaleString()} senders
      </div>
      {senders.map(sender => (
        <SenderRow
          key={sender.id}
          sender={sender}
          selected={selectedIds.has(sender.id)}
          onSelect={onSelect}
          onUnsubscribe={onUnsubscribe}
          onDelete={onDelete}
        />
      ))}
      {total > 50 && (
        <div className="flex items-center justify-center gap-4 p-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page} of {Math.ceil(total / 50)}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
