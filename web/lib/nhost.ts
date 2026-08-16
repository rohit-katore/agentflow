import { NhostClient } from '@nhost/react'

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local'
const region = process.env.NEXT_PUBLIC_NHOST_REGION || ''

export const nhost = new NhostClient({
  subdomain,
  region: region || undefined,
})

// nhost URL scheme: https://<subdomain>.graphql.<region>.nhost.run/v1
// The local CLI stack uses "local" for both subdomain and region.
export const graphqlHttpUrl =
  process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL ||
  'https://' + subdomain + '.graphql.' + (region || 'local') + '.nhost.run/v1'

export const graphqlWsUrl = graphqlHttpUrl.replace(/^http/, 'ws')
