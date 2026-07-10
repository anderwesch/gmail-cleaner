import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getQueue } from '@/lib/redis'
import { SYNC_QUEUE } from '@/worker/jobs/full-sync'

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id

  // Check for already-running sync
  const activeJob = await prisma.syncJob.findFirst({
    where: { userId, status: { in: ['queued', 'running'] } },
    orderBy: { startedAt: 'desc' },
  })

  if (activeJob) {
    return NextResponse.json({ syncJobId: activeJob.id, alreadyRunning: true })
  }

  // Mark user as syncing
  await prisma.user.update({ where: { id: userId }, data: { syncStatus: 'syncing' } })

  const syncJob = await prisma.syncJob.create({
    data: { userId, status: 'queued' },
  })

  const queue = getQueue(SYNC_QUEUE)
  await queue.add('full-sync', { userId, syncJobId: syncJob.id }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  })

  return NextResponse.json({ syncJobId: syncJob.id })
}
