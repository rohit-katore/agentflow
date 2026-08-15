import type { Request, Response } from 'express'
import { adminGql, AppError } from '../_lib/hasura'
import { verifyHasuraSecret } from '../_lib/auth'
import { executeRun, startRun } from '../_lib/engine'

type TriggerRow = {
  id: string
  is_enabled: boolean
  workflow: { id: string; is_active: boolean }
}

// Two entry points share this endpoint:
//  - the ingestWebhook Hasura action (body carries action/input)
//  - direct POSTs from external systems, using ?key=... or {"key": ...}
// Either way the secret webhook key is the credential; no session is needed.
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  const isAction = Boolean(req.body?.action?.name)
  if (isAction && !verifyHasuraSecret(req)) {
    return res.status(401).json({ message: 'Unauthorized' })
  }

  try {
    const key = isAction
      ? req.body?.input?.webhook_key
      : (req.query?.key as string) || req.body?.key
    const payload = isAction ? req.body?.input?.payload ?? {} : req.body?.payload ?? req.body ?? {}

    if (!key || typeof key !== 'string') throw new AppError('webhook key is required', 400)

    const data = await adminGql<{ workflow_triggers: TriggerRow[] }>(
      `query ($key: String!) {
        workflow_triggers(where: {webhook_key: {_eq: $key}, type: {_eq: "webhook"}}, limit: 1) {
          id
          is_enabled
          workflow { id is_active }
        }
      }`,
      { key }
    )
    const trigger = data.workflow_triggers[0]
    if (!trigger || !trigger.is_enabled || !trigger.workflow.is_active) {
      // identical response for a wrong key and a disabled trigger
      throw new AppError('Invalid webhook key', 404)
    }

    await adminGql(
      `mutation ($id: uuid!) {
        update_workflow_triggers_by_pk(pk_columns: {id: $id}, _set: {last_fired_at: "now()"}) { id }
      }`,
      { id: trigger.id }
    )

    const { runId } = await startRun({
      workflowId: trigger.workflow.id,
      via: 'webhook',
      userId: null,
      payload,
    })
    const result = await executeRun(runId)
    return res.json({ run_id: runId, status: result.status })
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Internal error'
    return res.status(status).json({ message })
  }
}
