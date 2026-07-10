'use client'

import { useState } from 'react'

interface DeleteConfirmModalProps {
  senderIds: string[]
  senderNames: string[]
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DeleteConfirmModal({ senderIds, senderNames, onClose, onConfirm }: DeleteConfirmModalProps) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete all emails?</h2>
        <p className="text-sm text-gray-500 mb-4">
          This will permanently delete all emails from {senderIds.length === 1
            ? senderNames[0]
            : `${senderIds.length} senders`}. This cannot be undone.
        </p>

        {senderIds.length > 1 && senderNames.length > 0 && (
          <ul className="mb-4 text-sm text-gray-600 max-h-32 overflow-y-auto space-y-1">
            {senderNames.slice(0, 5).map(name => (
              <li key={name} className="truncate">&bull; {name}</li>
            ))}
            {senderNames.length > 5 && (
              <li className="text-gray-400">...and {senderNames.length - 5} more</li>
            )}
          </ul>
        )}

        <button
          onClick={handleConfirm}
          disabled={loading}
          className="w-full mb-3 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl font-medium transition-colors"
        >
          {loading ? 'Deleting...' : 'Yes, delete all'}
        </button>
        <button
          onClick={onClose}
          disabled={loading}
          className="w-full px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
