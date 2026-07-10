'use client'

import { useState, useCallback } from 'react'
import type { SenderGroup } from '@prisma/client'
import { SenderList } from './_components/sender-list'
import { UnsubscribeModal } from './_components/unsubscribe-modal'
import { DeleteConfirmModal } from './_components/delete-confirm-modal'

export default function DashboardPage() {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedNames, setSelectedNames] = useState<Map<string, string>>(new Map())
  const [unsubscribeSender, setUnsubscribeSender] = useState<SenderGroup | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; names: string[] } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleSelect = useCallback((sender: SenderGroup, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      checked ? next.add(sender.id) : next.delete(sender.id)
      return next
    })
    setSelectedNames(prev => {
      const next = new Map(prev)
      checked ? next.set(sender.id, sender.senderName) : next.delete(sender.id)
      return next
    })
  }, [])

  const handleDeleteSingle = (sender: SenderGroup) => {
    setDeleteTarget({ ids: [sender.id], names: [sender.senderName] })
  }

  const handleBulkDelete = () => {
    setDeleteTarget({
      ids: [...selectedIds],
      names: [...selectedNames.values()],
    })
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderGroupIds: deleteTarget.ids }),
    })
    setSelectedIds(new Set())
    setSelectedNames(new Map())
    setRefreshKey(k => k + 1)
  }

  const handleUnsubscribeSuccess = () => {
    setRefreshKey(k => k + 1)
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
          key={refreshKey}
          search={search}
          selectedIds={selectedIds}
          onSelect={(sender, checked) => handleSelect(sender, checked)}
          onUnsubscribe={setUnsubscribeSender}
          onDelete={handleDeleteSingle}
        />
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 text-sm">
          <span>{selectedIds.size} selected</span>
          <button
            onClick={handleBulkDelete}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 rounded-full transition-colors"
          >
            Delete all
          </button>
          <button
            onClick={() => {
              // For bulk unsubscribe, we need senders with unsubscribe links
              // Since we only have IDs, the user will need to unsubscribe one-by-one
              // Show a toast/note that they should unsubscribe individually
              // For now, clear selection to guide the user
              alert(`Select a single sender and click Unsubscribe to unsubscribe one at a time.`)
            }}
            className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 rounded-full transition-colors"
          >
            Unsubscribe selected
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setSelectedNames(new Map()) }}
            className="text-gray-400 hover:text-white transition-colors"
          >
            &times;
          </button>
        </div>
      )}

      {unsubscribeSender && (
        <UnsubscribeModal
          sender={unsubscribeSender}
          onClose={() => setUnsubscribeSender(null)}
          onSuccess={handleUnsubscribeSuccess}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          senderIds={deleteTarget.ids}
          senderNames={deleteTarget.names}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  )
}
