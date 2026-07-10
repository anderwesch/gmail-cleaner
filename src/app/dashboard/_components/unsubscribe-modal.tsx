'use client'

import { useState } from 'react'
import type { SenderGroup } from '@prisma/client'

interface UnsubscribeModalProps {
  sender: SenderGroup
  onClose: () => void
  onSuccess: (senderGroupId: string, deleted: boolean) => void
}

export function UnsubscribeModal({ sender, onClose, onSuccess }: UnsubscribeModalProps) {
  const [step, setStep] = useState<'confirm' | 'opened-link' | 'loading'>('confirm')
  const [deleteExisting, setDeleteExisting] = useState(false)

  const handleUnsubscribeViaLink = () => {
    window.open(sender.unsubscribeUrl!, '_blank')
    setStep('opened-link')
  }

  const handleConfirmDone = async () => {
    setStep('loading')
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderGroupId: sender.id, deleteExisting }),
    })
    onSuccess(sender.id, deleteExisting)
    onClose()
  }

  const handleUnsubscribeViaEmail = async () => {
    setStep('loading')
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderGroupId: sender.id, deleteExisting }),
    })
    onSuccess(sender.id, deleteExisting)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Unsubscribe from {sender.senderName}
        </h2>
        <p className="text-sm text-gray-500 mb-6">{sender.senderEmail}</p>

        {step === 'confirm' && (
          <>
            <div className="mb-6 p-4 bg-gray-50 rounded-xl">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteExisting}
                  onChange={e => setDeleteExisting(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Also delete {sender.emailCount.toLocaleString()} existing emails
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Permanently removes all emails from this sender
                  </div>
                </div>
              </label>
            </div>

            {sender.unsubscribeUrl && (
              <button
                onClick={handleUnsubscribeViaLink}
                className="w-full mb-3 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
              >
                Open unsubscribe page
              </button>
            )}

            {!sender.unsubscribeUrl && sender.unsubscribeEmail && (
              <button
                onClick={handleUnsubscribeViaEmail}
                className="w-full mb-3 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
              >
                Send unsubscribe email
              </button>
            )}

            <button onClick={onClose} className="w-full px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
              Cancel
            </button>
          </>
        )}

        {step === 'opened-link' && (
          <>
            <p className="text-sm text-gray-600 mb-6">
              Complete the unsubscribe on the page that opened in your browser, then click below.
            </p>
            {deleteExisting && (
              <p className="text-xs text-gray-500 mb-4">
                {sender.emailCount.toLocaleString()} existing emails will also be deleted.
              </p>
            )}
            <button
              onClick={handleConfirmDone}
              className="w-full mb-3 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors"
            >
              I&apos;ve unsubscribed
            </button>
            <button onClick={onClose} className="w-full px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
              Cancel
            </button>
          </>
        )}

        {step === 'loading' && (
          <div className="flex items-center justify-center py-8 text-gray-500">
            Processing...
          </div>
        )}
      </div>
    </div>
  )
}
