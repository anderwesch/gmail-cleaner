import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis: IORedis }

export const redis =
  globalForRedis.redis ??
  new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis

export function getQueue(name: string): Queue {
  return new Queue(name, { connection: redis as unknown as ConnectionOptions })
}

export { Worker }
