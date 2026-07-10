import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SenderCategory } from '@prisma/client'

const CATEGORY_LABELS: Record<SenderCategory, string> = {
  newsletters: 'Newsletters',
  promotions: 'Promotions',
  social: 'Social notifications',
  updates: 'App updates',
  ridesharing: 'Ride sharing apps',
  food: 'Food delivery apps',
  receipts: 'Receipts & orders',
  oldmail: 'Old mail (2+ years)',
  largemail: 'Large attachments',
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const groups = await prisma.senderGroup.groupBy({
      by: ['category'],
      where: {
        userId: session.user.id,
        status: { not: 'deleted' },
        category: { not: null },
      },
      _sum: { emailCount: true },
      _count: { id: true },
      orderBy: { _sum: { emailCount: 'desc' } },
      take: 3,
    })

    const suggestions = await Promise.all(
      groups.map(async g => {
        const topSenders = await prisma.senderGroup.findMany({
          where: {
            userId: session.user.id,
            category: g.category,
            status: { not: 'deleted' },
          },
          orderBy: { emailCount: 'desc' },
          take: 3,
          select: { senderName: true },
        })

        return {
          category: g.category as SenderCategory,
          label: CATEGORY_LABELS[g.category as SenderCategory],
          totalEmails: g._sum.emailCount ?? 0,
          topSenders: topSenders.map(s => s.senderName),
          senderCount: g._count.id,
        }
      })
    )

    return NextResponse.json({ suggestions })
  } catch {
    return NextResponse.json({ suggestions: [] })
  }
}
