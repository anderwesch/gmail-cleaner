import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SenderCategory } from '@prisma/client'

const VALID_CATEGORIES: SenderCategory[] = [
  'newsletters', 'promotions', 'social', 'updates',
  'ridesharing', 'food', 'receipts', 'oldmail', 'largemail',
]

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

  const categoryParam = searchParams.get('category')
  const location = searchParams.get('location') ?? 'all'

  const categoryFilter = categoryParam && VALID_CATEGORIES.includes(categoryParam as SenderCategory)
    ? { category: categoryParam as SenderCategory }
    : {}

  const locationFilter =
    location === 'inbox'    ? { inboxCount: { gt: 0 } } :
    location === 'archived' ? { archivedCount: { gt: 0 } } :
    {}

  const orderBy =
    location === 'inbox'    ? { inboxCount: 'desc' as const } :
    location === 'archived' ? { archivedCount: 'desc' as const } :
    { emailCount: 'desc' as const }

  const where = {
    userId: session.user.id,
    status: { not: 'deleted' as const },
    ...categoryFilter,
    ...locationFilter,
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
    prisma.senderGroup.findMany({ where, orderBy, skip, take: limit }),
    prisma.senderGroup.count({ where }),
  ])

  return NextResponse.json({ senders, total })
}
