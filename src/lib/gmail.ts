import { google, gmail_v1 } from 'googleapis'

export function createGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  return google.gmail({ version: 'v1', auth })
}
