import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { prisma } from './prisma'
import { encrypt } from './crypto'
import { getQueue } from './redis'
import { SYNC_QUEUE } from '@/worker/jobs/full-sync'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/gmail.modify',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.provider !== 'google') return false
      if (!account.access_token || !account.refresh_token) return false

      const existing = await prisma.user.findUnique({ where: { email: user.email! } })

      const dbUser = await prisma.user.upsert({
        where: { email: user.email! },
        create: {
          email: user.email!,
          name: user.name ?? '',
          avatar: user.image ?? null,
          googleAccessToken: encrypt(account.access_token),
          googleRefreshToken: encrypt(account.refresh_token),
        },
        update: {
          googleAccessToken: encrypt(account.access_token),
          googleRefreshToken: encrypt(account.refresh_token),
          name: user.name ?? '',
          avatar: user.image ?? null,
        },
      })

      // Enqueue sync for new users only
      if (!existing) {
        const syncJob = await prisma.syncJob.create({
          data: { userId: dbUser.id, status: 'queued' },
        })
        const queue = getQueue(SYNC_QUEUE)
        await queue.add('full-sync', { userId: dbUser.id, syncJobId: syncJob.id }, {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
        })
      }

      return true
    },
    async session({ session, token }) {
      const dbUser = await prisma.user.findUnique({
        where: { email: token.email! },
        select: { id: true, syncStatus: true },
      })
      if (dbUser) {
        session.user.id = dbUser.id
      }
      return session
    },
  },
  pages: {
    signIn: '/',
  },
})
