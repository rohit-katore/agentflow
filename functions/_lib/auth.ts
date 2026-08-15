import type { Request } from 'express'
import { adminGql, AppError } from './hasura'

// Hasura attaches this header to every action / event trigger / cron call it
// makes to our functions. Endpoints that should never be called directly from
// the open internet must verify it.
export function verifyHasuraSecret(req: Request): boolean {
  const secret = process.env.NHOST_WEBHOOK_SECRET
  return Boolean(secret) && req.headers['x-nhost-webhook-secret'] === secret
}

export function sessionUserId(req: Request): string {
  const id = req.body?.session_variables?.['x-hasura-user-id']
  if (!id) throw new AppError('Not authenticated', 401)
  return id
}

export async function getMembership(
  orgId: string,
  userId: string
): Promise<{ role: string } | null> {
  const data = await adminGql<{ org_members: Array<{ role: string }> }>(
    `query ($orgId: uuid!, $userId: uuid!) {
      org_members(where: {org_id: {_eq: $orgId}, user_id: {_eq: $userId}}, limit: 1) {
        role
      }
    }`,
    { orgId, userId }
  )
  return data.org_members[0] || null
}

// Layer 1 check used by the action handlers. Non-members get a 404 rather
// than a 403 so guessing IDs does not even confirm that the resource exists.
export async function requireRole(
  orgId: string,
  userId: string,
  roles: string[]
): Promise<string> {
  const membership = await getMembership(orgId, userId)
  if (!membership) throw new AppError('Not found', 404)
  if (!roles.includes(membership.role)) {
    throw new AppError(`This action requires one of: ${roles.join(', ')}`, 403)
  }
  return membership.role
}
