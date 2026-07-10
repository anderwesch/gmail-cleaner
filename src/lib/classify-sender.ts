import type { SenderCategory } from '@prisma/client'

export const CATEGORY_DOMAINS: Record<'ridesharing' | 'food' | 'receipts', string[]> = {
  ridesharing: ['uber.com', 'lyft.com', 'cabify.com', '99app.com', 'grab.com', 'bolt.eu'],
  food: [
    'ifood.com.br', 'rappi.com', 'doordash.com', 'ubereats.com',
    'deliveroo.com', 'grubhub.com', 'instacart.com', 'pedidosya.com',
  ],
  receipts: [
    'amazon.com', 'amazon.com.br', 'mercadolibre.com', 'mercadopago.com',
    'shopify.com', 'paypal.com', 'stripe.com', 'apple.com', 'google.com',
  ],
}

export const CATEGORY_PRIORITY: SenderCategory[] = [
  'ridesharing', 'food', 'receipts', 'newsletters',
  'social', 'updates', 'promotions', 'oldmail', 'largemail',
]

function domainOf(email: string): string {
  return email.toLowerCase().split('@').pop() ?? ''
}

function matchesDomain(emailDomain: string, ruleDomain: string): boolean {
  return emailDomain === ruleDomain || emailDomain.endsWith(`.${ruleDomain}`)
}

export function classifyByDomain(
  senderEmail: string,
  hasUnsubscribeLink: boolean,
): SenderCategory | null {
  const domain = domainOf(senderEmail)

  for (const [category, domains] of Object.entries(CATEGORY_DOMAINS) as [
    'ridesharing' | 'food' | 'receipts',
    string[],
  ][]) {
    if (domains.some(d => matchesDomain(domain, d))) return category
  }

  if (hasUnsubscribeLink) return 'newsletters'

  return null
}
