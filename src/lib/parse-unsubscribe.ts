export function parseUnsubscribeHeader(header: string): {
  url: string | null
  email: string | null
} {
  if (!header) return { url: null, email: null }

  const urlMatch = header.match(/<(https?:\/\/[^>]+)>/)
  const mailtoMatch = header.match(/<mailto:([^?>\s]+)/)

  return {
    url: urlMatch ? urlMatch[1] : null,
    email: mailtoMatch ? mailtoMatch[1] : null,
  }
}
