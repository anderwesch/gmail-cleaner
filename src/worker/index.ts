import { Worker, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { processFullSync, SYNC_QUEUE } from './jobs/full-sync'

console.log('Worker starting...')

const syncWorker = new Worker(SYNC_QUEUE, processFullSync, {
  connection: redis as unknown as ConnectionOptions,
  concurrency: 2,
  limiter: { max: 10, duration: 1000 }, // 10 jobs/sec max
})

syncWorker.on('completed', job => {
  console.log(`Sync job ${job.id} completed`)
})

syncWorker.on('failed', (job, err) => {
  console.error(`Sync job ${job?.id} failed:`, err.message)
})

console.log(`Worker listening on queue: ${SYNC_QUEUE}`)
