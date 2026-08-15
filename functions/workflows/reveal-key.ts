import type { Request, Response } from 'express'
import { adminGql, AppError, functionsUrl } from '../_lib/hasura'
import { requireRole, sessionUserId, verifyHasuraSecret } from '../_lib/auth'

// Handler for the revealWebhookKey action. webhook_key is not selectable
// through GraphQL for anyone; this is the only way to read it, and it is
// limited to owners/editors of the trigger's own org.
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  if (!verifyHasuraSecret(req)) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const userId = sessionUserId(req)
    const { trigger_id } = req.body?.input ?? {}
    if (!trigger_id) throw new AppError('trigger_id is required', 400)

    const data = await adminGql<{
      workflow_triggers_by_pk: {
        id: string
        type: string
        webhook_key: string
        workflow: { org_id: string }
      } | null
    }>(
      `query ($id: uuid!) {
        workflow_triggers_by_pk(id: $id) {
          id
          type
          webhook_key
          workflow { org_id }
        }
      }`,
      { id: trigger_id }
    )
    const trigger = data.workflow_triggers_by_pk
    if (!trigger || trigger.type !== 'webhook') throw new AppError('Not found', 404)

    await requireRole(trigger.workflow.org_id, userId, ['owner', 'editor'])

    return res.json({
      webhook_key: trigger.webhook_key,
      webhook_url: `${functionsUrl}/workflows/webhook?key=${trigger.webhook_key}`,
    })
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Internal error'
    return res.status(status).json({ message })
  }
}
