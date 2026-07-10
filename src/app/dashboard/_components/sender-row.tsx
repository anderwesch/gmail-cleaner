'use client'

import type { SenderGroup } from '@prisma/client'

interface SenderRowProps {
  sender: SenderGroup
  selected: boolean
  onSelect: (sender: SenderGroup, checked: boolean) => void
  onUnsubscribe: (sender: SenderGroup) => void
  onDelete: (sender: SenderGroup) => void
}

export function SenderRow({ sender, selected, onSelect, onUnsubscribe, onDelete }: SenderRowProps) {
  const isUnsubscribed = sender.status === 'unsubscribed'

  return (
    <div data-testid="sender-row" className={`flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selected ? 'bg-blue-50' : ''}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={e => onSelect(sender, e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-blue-600"
      />

      <div className="flex-1 min-w-0">
        <div className={`font-medium text-gray-900 truncate ${isUnsubscribed ? 'line-through text-gray-400' : ''}`}>
          {sender.senderName}
        </div>
        <div className="text-sm text-gray-500 truncate">{sender.senderEmail}</div>
      </div>

      <div className="text-sm text-gray-500 whitespace-nowrap">
        <span className="font-medium text-gray-700">{sender.emailCount.toLocaleString()}</span> emails
      </div>

      {isUnsubscribed && (
        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Unsubscribed</span>
      )}

      {!isUnsubscribed && sender.hasUnsubscribeLink && (
        <button
          onClick={() => onUnsubscribe(sender)}
          className="text-sm px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap"
        >
          Unsubscribe
        </button>
      )}

      <button
        onClick={() => onDelete(sender)}
        className="text-sm px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
      >
        Delete all
      </button>
    </div>
  )
}
