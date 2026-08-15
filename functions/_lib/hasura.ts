type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> }

export class AppError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const subdomain = process.env.NHOST_SUBDOMAIN || 'local'
const region = process.env.NHOST_REGION || 'local'

export const graphqlUrl =
  process.env.NHOST_GRAPHQL_URL ||
  'https://' + subdomain + '.graphql.' + region + '.nhost.run/v1'

export const functionsUrl =
  process.env.NHOST_FUNCTIONS_URL ||
  'https://' + subdomain + '.functions.' + region + '.nhost.run/v1'

export async function adminGql<T = any>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': process.env.NHOST_ADMIN_SECRET || '',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new Error(`hasura request failed with status ${res.status}`)
  }
  const json = (await res.json()) as GqlResponse<T>
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message)
  }
  return json.data as T
}
