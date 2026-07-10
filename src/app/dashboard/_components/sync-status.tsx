'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SyncStatusResponse } from '@/types'

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null)

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/sync/status')
    if (res.ok) setStatus(await res.json())
  }, [])

  const triggerSync = async () => {
    await fetch('/api/sync', { method: 'POST' })
    fetchStatus()
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  if (!status) return null

  const isSyncing = status.status === 'syncing'
  const isError = status.status === 'error'

  return (
    <div className="flex items-center gap-3">
      {isSyncing && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
          <span>
            Syncing{status.totalEmails
              ? ` ${status.processedEmails.toLocaleString()} / ${status.totalEmails.toLocaleString()}`
              : '...'}
          </span>
          <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        </div>
      )}

      {isError && (
        <span className="text-sm text-red-600">
          Sync failed — {status.errorMessage}
        </span>
      )}

      {!isSyncing && (
        <button
          onClick={triggerSync}
          className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
        >
          {isError ? 'Retry sync' : 'Re-sync'}
        </button>
      )}
    </div>
  )
}
