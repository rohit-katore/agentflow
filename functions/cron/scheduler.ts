import type { Request, Response } from 'express'
import parser from 'cron-parser'
import { adminGql } from '../_lib/hasura'
import { verifyHasuraSecret } from '../_lib/auth'
import { executeRun, startRun } from '../_lib/engine'

type ScheduledTrigger = {
  id: string
  config: any
  last_fired_at: string | null
  created_at: string
  workflow: { id: string }
}

// Called by the workflow-scheduler cron trigger once a minute. Each schedule
// trigger keeps a cron expression in config.cron; fire the ones that are due.
export default async function handler(req: Request, res: Response) {
  if (!verifyHasuraSecret(req)) return res.status(401).json({ message: 'Unauthorized' })

  const data = await adminGql<{ workflow_triggers: ScheduledTrigger[] }>(
    `query {
      workflow_triggers(
        where: {
          type: {_eq: "schedule"}
          is_enabled: {_eq: true}
          workflow: {is_active: {_eq: true}}
        }
      ) {
        id
        config
        last_fired_at
        created_at
        workflow { id }
      }
    }`
  )

  const now = new Date()
  const fired: string[] = []
  const errors: Array<{ trigger_id: string; error: string }> = []

  for (const trigger of data.workflow_triggers) {
    const cron = trigger.config?.cron
    if (!cron || typeof cron !== 'string') continue

    let due = false
    try {
      const from = new Date(trigger.last_fired_at ?? trigger.created_at)
      due = parser.parseExpression(cron, { currentDate: from }).next().toDate() <= now
    } catch {
      errors.push({ trigger_id: trigger.id, error: `invalid cron expression: ${cron}` })
      continue
    }
    if (!due) continue

    // claim the trigger before running so two overlapping scheduler
    // invocations cannot both fire it
    const claimQuery = trigger.last_fired_at
      ? `mutation ($id: uuid!, $seen: timestamptz!) {
          update_workflow_triggers(
            where: {id: {_eq: $id}, last_fired_at: {_eq: $seen}}
            _set: {last_fired_at: "now()"}
          ) { affected_rows }
        }`
      : `mutation ($id: uuid!) {
          update_workflow_triggers(
            where: {id: {_eq: $id}, last_fired_at: {_is_null: true}}
            _set: {last_fired_at: "now()"}
          ) { affected_rows }
        }`
    const claim = await adminGql<{ update_workflow_triggers: { affected_rows: number } }>(
      claimQuery,
      trigger.last_fired_at ? { id: trigger.id, seen: trigger.last_fired_at } : { id: trigger.id }
    )
    if (claim.update_workflow_triggers.affected_rows === 0) continue

    try {
      const { runId } = await startRun({
        workflowId: trigger.workflow.id,
        via: 'schedule',
        userId: null,
        payload: { cron, scheduled_for: now.toISOString() },
      })
      await executeRun(runId)
      fired.push(runId)
    } catch (err) {
      errors.push({
        trigger_id: trigger.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return res.json({ checked: data.workflow_triggers.length, fired, errors })
}
