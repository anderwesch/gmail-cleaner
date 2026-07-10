export interface RawMessage {
  id: string
  from: string
  listUnsubscribe: string | null
  internalDate: string // milliseconds since epoch as string
}

export interface SenderUpsertData {
  senderEmail: string
  senderName: string
  emailCount: number
  latestEmailDate: Date
  hasUnsubscribeLink: boolean
  unsubscribeUrl: string | null
  unsubscribeEmail: string | null
}

export interface SyncStatusResponse {
  status: 'idle' | 'syncing' | 'error'
  progress: number
  totalEmails: number | null
  processedEmails: number
  errorMessage: string | null
}
