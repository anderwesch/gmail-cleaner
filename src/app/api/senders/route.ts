import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50
  const skip = (page - 1) * limit

  const where = {
    userId: session.user.id,
    status: { not: 'deleted' as const },
    ...(search
      ? {
          OR: [
            { senderEmail: { contains: search, mode: 'insensitive' as const } },
            { senderName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [senders, total] = await Promise.all([
    prisma.senderGroup.findMany({
      where,
      orderBy: { emailCount: 'desc' },
      skip,
      take: limit,
    }),
    prisma.senderGroup.count({ where }),
  ])

  return NextResponse.json({ senders, total })
}
