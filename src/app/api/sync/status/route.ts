import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SyncStatusResponse } from '@/types'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { syncStatus: true },
  })

  const latestJob = await prisma.syncJob.findFirst({
    where: { userId: session.user.id },
    orderBy: { startedAt: 'desc' },
    select: { status: true, progress: true, totalEmails: true, processedEmails: true, errorMessage: true },
  })

  const response: SyncStatusResponse = {
    status: user.syncStatus,
    progress: latestJob?.progress ?? 0,
    totalEmails: latestJob?.totalEmails ?? null,
    processedEmails: latestJob?.processedEmails ?? 0,
    errorMessage: latestJob?.errorMessage ?? null,
  }

  return NextResponse.json(response)
}
