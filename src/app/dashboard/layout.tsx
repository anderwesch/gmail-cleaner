import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { SyncStatus } from './_components/sync-status'
import Image from 'next/image'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-gray-900">Gmail Cleanup</h1>
          <SyncStatus />
          <div className="flex items-center gap-2">
            {session.user.image && (
              <Image
                src={session.user.image}
                alt={session.user.name}
                width={32}
                height={32}
                className="rounded-full"
              />
            )}
            <span className="text-sm text-gray-700 hidden sm:block">{session.user.name}</span>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto py-6 px-4">{children}</main>
    </div>
  )
}
