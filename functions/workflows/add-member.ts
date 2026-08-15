import type { Request, Response } from 'express'
import { adminGql, AppError } from '../_lib/hasura'
import { requireRole, sessionUserId, verifyHasuraSecret } from '../_lib/auth'

const ROLES = ['owner', 'editor', 'viewer']

// Handler for the addOrgMember action. Membership management is owner-only
// (editors explicitly cannot manage members).
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  if (!verifyHasuraSecret(req)) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const userId = sessionUserId(req)
    const { org_id, email, role } = req.body?.input ?? {}
    if (!org_id || !email) throw new AppError('org_id and email are required', 400)
    if (!ROLES.includes(role)) throw new AppError(`role must be one of: ${ROLES.join(', ')}`, 400)

    await requireRole(org_id, userId, ['owner'])

    const users = await adminGql<{ users: Array<{ id: string; email: string }> }>(
      `query ($email: citext!) {
        users(where: {email: {_eq: $email}}, limit: 1) { id email }
      }`,
      { email: String(email).trim().toLowerCase() }
    )
    const target = users.users[0]
    if (!target) throw new AppError('No account with that email has signed up yet', 404)

    const upsert = await adminGql<{ insert_org_members_one: { id: string } }>(
      `mutation ($object: org_members_insert_input!) {
        insert_org_members_one(
          object: $object
          on_conflict: {constraint: org_members_org_id_user_id_key, update_columns: [role]}
        ) { id }
      }`,
      { object: { org_id, user_id: target.id, role, member_email: target.email } }
    )
    return res.json({ member_id: upsert.insert_org_members_one.id, user_id: target.id })
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Internal error'
    return res.status(status).json({ message })
  }
}
