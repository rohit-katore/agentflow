import type { Request, Response } from 'express'
import { adminGql, AppError } from '../_lib/hasura'
import { requireRole, sessionUserId, verifyHasuraSecret } from '../_lib/auth'
import { executeRun, startRun } from '../_lib/engine'

// Handler for the triggerWorkflowRun action.
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  if (!verifyHasuraSecret(req)) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const userId = sessionUserId(req)
    const { workflow_id, payload } = req.body?.input ?? {}
    if (!workflow_id) throw new AppError('workflow_id is required', 400)

    const data = await adminGql<{ workflows_by_pk: { org_id: string } | null }>(
      `query ($id: uuid!) { workflows_by_pk(id: $id) { org_id } }`,
      { id: workflow_id }
    )
    if (!data.workflows_by_pk) throw new AppError('Not found', 404)

    // Layer 1: caller must be owner or editor in the workflow's org.
    // Viewers cannot trigger, and members of other orgs get a 404.
    await requireRole(data.workflows_by_pk.org_id, userId, ['owner', 'editor'])

    const { runId } = await startRun({
      workflowId: workflow_id,
      via: 'manual',
      userId,
      payload: payload ?? {},
    })
    const result = await executeRun(runId)
    return res.json({ run_id: runId, status: result.status })
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Internal error'
    return res.status(status).json({ message })
  }
}
