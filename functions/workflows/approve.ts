import type { Request, Response } from 'express'
import { adminGql, AppError } from '../_lib/hasura'
import { getMembership, sessionUserId, verifyHasuraSecret } from '../_lib/auth'
import { executeRun } from '../_lib/engine'

// Handler for the approveStep action.
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  if (!verifyHasuraSecret(req)) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const userId = sessionUserId(req)
    const { step_run_id, decision, comment } = req.body?.input ?? {}
    if (!step_run_id) throw new AppError('step_run_id is required', 400)
    if (decision !== 'approve' && decision !== 'reject') {
      throw new AppError('decision must be "approve" or "reject"', 400)
    }

    const data = await adminGql<{
      step_runs_by_pk: {
        id: string
        status: string
        step_type: string
        config: any
        run: { id: string; status: string; org_id: string }
      } | null
    }>(
      `query ($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id
          status
          step_type
          config
          run { id status org_id }
        }
      }`,
      { id: step_run_id }
    )
    const stepRun = data.step_runs_by_pk
    if (!stepRun || stepRun.step_type !== 'approval_gate') throw new AppError('Not found', 404)

    // Layer 2, enforced here in the handler: clearing a gate is a
    // mid-execution decision, so the approver's org role is checked in code
    // before the run resumes. A row permission cannot express this.
    const membership = await getMembership(stepRun.run.org_id, userId)
    if (!membership) throw new AppError('Not found', 404)
    const required = stepRun.config?.require_role === 'owner' ? ['owner'] : ['owner', 'editor']
    if (!required.includes(membership.role)) {
      throw new AppError(`Only an org ${required.join(' or ')} can act on this approval gate`, 403)
    }

    if (stepRun.status !== 'waiting_approval') {
      throw new AppError(`This step is not waiting for approval (status: ${stepRun.status})`, 409)
    }

    if (decision === 'reject') {
      await adminGql(
        `mutation ($stepId: uuid!, $runId: uuid!, $userId: uuid!, $output: jsonb!, $skipped: jsonb!) {
          update_step_runs_by_pk(
            pk_columns: {id: $stepId}
            _set: {status: "failed", approved_by: $userId, approved_at: "now()", finished_at: "now()", output: $output, error: "Rejected by approver"}
          ) { id }
          update_workflow_runs_by_pk(
            pk_columns: {id: $runId}
            _set: {status: "cancelled", error: "Approval was rejected", finished_at: "now()"}
          ) { id }
          update_step_runs(
            where: {run_id: {_eq: $runId}, status: {_eq: "pending"}}
            _set: {status: "skipped", output: $skipped, finished_at: "now()"}
          ) { affected_rows }
        }`,
        {
          stepId: step_run_id,
          runId: stepRun.run.id,
          userId,
          output: { decision: 'rejected', comment: comment ?? null },
          skipped: { skipped: true, reason: 'approval was rejected' },
        }
      )
      return res.json({ run_id: stepRun.run.id, status: 'cancelled' })
    }

    await adminGql(
      `mutation ($stepId: uuid!, $runId: uuid!, $userId: uuid!, $output: jsonb!) {
        update_step_runs_by_pk(
          pk_columns: {id: $stepId}
          _set: {status: "completed", approved_by: $userId, approved_at: "now()", finished_at: "now()", output: $output}
        ) { id }
        update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {status: "running"}) { id }
      }`,
      {
        stepId: step_run_id,
        runId: stepRun.run.id,
        userId,
        output: { decision: 'approved', comment: comment ?? null },
      }
    )
    const result = await executeRun(stepRun.run.id)
    return res.json({ run_id: stepRun.run.id, status: result.status })
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Internal error'
    return res.status(status).json({ message })
  }
}
