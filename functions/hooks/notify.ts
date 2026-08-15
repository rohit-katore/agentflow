import type { Request, Response } from 'express'
import { adminGql } from '../_lib/hasura'
import { verifyHasuraSecret } from '../_lib/auth'

async function markNotification(id: string, status: 'sent' | 'failed', detail: string) {
  await adminGql(
    `mutation ($id: uuid!, $status: String!, $detail: String!) {
      update_notifications_by_pk(
        pk_columns: {id: $id}
        _set: {status: $status, detail: $detail, sent_at: "now()"}
      ) { id }
    }`,
    { id, status, detail }
  )
}

// Endpoint for the notification_created event trigger: fires on every insert
// into notifications (i.e. every executed notify step) and delivers it.
export default async function handler(req: Request, res: Response) {
  if (!verifyHasuraSecret(req)) return res.status(401).json({ message: 'Unauthorized' })

  const row = req.body?.event?.data?.new
  if (!row?.id) return res.status(400).json({ message: 'Malformed event payload' })

  const currentRetry: number = req.body?.delivery_info?.current_retry ?? 0
  const slackUrl = process.env.SLACK_WEBHOOK_URL

  if (row.channel !== 'slack' || !slackUrl) {
    const detail =
      row.channel === 'slack' ? 'SLACK_WEBHOOK_URL not set, logged only' : 'log channel'
    console.log(`[notify] ${detail}: ${row.message}`)
    await markNotification(row.id, 'sent', detail)
    return res.json({ delivered: 'log' })
  }

  try {
    const slackRes = await fetch(slackUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: row.message }),
    })
    if (!slackRes.ok) throw new Error(`slack returned ${slackRes.status}`)
    await markNotification(row.id, 'sent', 'delivered to slack')
    return res.json({ delivered: 'slack' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (currentRetry >= 3) {
      await markNotification(row.id, 'failed', message)
      return res.json({ delivered: 'failed' })
    }
    // a non-2xx response makes Hasura retry per retry_conf
    return res.status(500).json({ message })
  }
}
