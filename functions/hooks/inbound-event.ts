import type { Request, Response } from 'express'
import { adminGql } from '../_lib/hasura'
import { verifyHasuraSecret } from '../_lib/auth'
import { executeRun, startRun } from '../_lib/engine'

// Endpoint for the inbound_event_created event trigger: a row inserted into
// the watched inbound_events table auto-starts every active workflow in that
// org that has an enabled db_event trigger.
export default async function handler(req: Request, res: Response) {
  if (!verifyHasuraSecret(req)) return res.status(401).json({ message: 'Unauthorized' })

  const row = req.body?.event?.data?.new
  if (!row?.id || !row?.org_id) {
    return res.status(400).json({ message: 'Malformed event payload' })
  }

  const data = await adminGql<{
    workflow_triggers: Array<{ id: string; workflow: { id: string } }>
  }>(
    `query ($orgId: uuid!) {
      workflow_triggers(
        where: {
          type: {_eq: "db_event"}
          is_enabled: {_eq: true}
          workflow: {org_id: {_eq: $orgId}, is_active: {_eq: true}}
        }
      ) {
        id
        workflow { id }
      }
    }`,
    { orgId: row.org_id }
  )

  const seen = new Set<string>()
  const targets = data.workflow_triggers
    .filter((t) => !seen.has(t.workflow.id) && Boolean(seen.add(t.workflow.id)))
    .slice(0, 3) // safety cap per event

  const payloadBase =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? row.payload
      : { value: row.payload }

  const started: string[] = []
  const errors: Array<{ workflow_id: string; error: string }> = []

  for (const t of targets) {
    try {
      await adminGql(
        `mutation ($id: uuid!) {
          update_workflow_triggers_by_pk(pk_columns: {id: $id}, _set: {last_fired_at: "now()"}) { id }
        }`,
        { id: t.id }
      )
      const { runId } = await startRun({
        workflowId: t.workflow.id,
        via: 'db_event',
        userId: null,
        payload: { ...payloadBase, _event_id: row.id, _event_source: row.source },
      })
      await executeRun(runId)
      started.push(runId)
    } catch (err) {
      errors.push({
        workflow_id: t.workflow.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return res.json({ started, errors })
}
