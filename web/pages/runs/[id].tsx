import { useMutation, useSubscription } from '@apollo/client'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import Layout from '../../components/Layout'
import StatusBadge from '../../components/StatusBadge'
import { useOrg } from '../../lib/org'
import { APPROVE_STEP, RUN_SUB, STEP_RUNS_SUB } from '../../lib/queries'

function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return null
  return `${(ms / 1000).toFixed(1)}s`
}

function Pretty({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null
  return <pre className="output">{JSON.stringify(value, null, 2)}</pre>
}

export default function RunPage() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const { orgs } = useOrg()
  const [comment, setComment] = useState('')

  const { data: runData } = useSubscription(RUN_SUB, { variables: { id }, skip: !id })
  const { data: stepsData } = useSubscription(STEP_RUNS_SUB, {
    variables: { runId: id },
    skip: !id,
  })
  const [approveStep, { loading: deciding, error: approveError }] = useMutation(APPROVE_STEP)

  const run = runData?.workflow_runs_by_pk
  const steps = stepsData?.step_runs ?? []

  if (!run) {
    return (
      <Layout>
        <div className="page-loading">
          Waiting for the live run stream… if nothing appears, this run may belong to an
          organization you are not a member of.
        </div>
      </Layout>
    )
  }

  const role = orgs.find((o) => o.id === run.org_id)?.role
  const waiting = steps.find((s: any) => s.status === 'waiting_approval')
  const requiredRole = waiting?.input?.require_role === 'owner' ? 'owner' : 'editor'
  const canApprove =
    role === 'owner' || (role === 'editor' && requiredRole === 'editor')

  const decide = (decision: 'approve' | 'reject') => {
    if (!waiting) return
    void approveStep({
      variables: { stepRunId: waiting.id, decision, comment: comment.trim() || null },
    })
  }

  return (
    <Layout>
      <div className="toolbar">
        <div>
          <h1 className="page-title">
            {run.workflow ? (
              <Link href={`/workflows/${run.workflow.id}`}>{run.workflow.name}</Link>
            ) : (
              'Workflow run'
            )}
          </h1>
          <p className="muted">
            Run {run.id.slice(0, 8)} · via {run.triggered_via} · started{' '}
            {run.started_at ? new Date(run.started_at).toLocaleString() : '–'}
            {run.finished_at && <> · took {duration(run.started_at, run.finished_at)}</>}
          </p>
        </div>
        <div className="spacer" />
        <StatusBadge status={run.status} />
      </div>

      {run.error && <p className="form-error">{run.error}</p>}

      {waiting && (
        <div className="approval-panel">
          <h3>Paused — waiting for approval</h3>
          <p className="muted">
            “{waiting.step_name}” needs sign-off from an org {requiredRole === 'owner' ? 'owner' : 'owner or editor'}.
            {waiting.input?.note && <> Note: {waiting.input.note}</>}
          </p>
          {canApprove ? (
            <>
              <label className="field">
                <span>Comment (optional)</span>
                <input
                  className="input"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <div className="row">
                <button
                  className="btn btn-primary"
                  disabled={deciding}
                  onClick={() => decide('approve')}
                >
                  {deciding ? 'Working…' : 'Approve & resume'}
                </button>
                <button className="btn btn-danger" disabled={deciding} onClick={() => decide('reject')}>
                  Reject
                </button>
              </div>
            </>
          ) : (
            <p className="muted">
              Your role ({role ?? 'not a member'}) cannot clear this gate. Ask an org{' '}
              {requiredRole === 'owner' ? 'owner' : 'owner or editor'}.
            </p>
          )}
          {approveError && <p className="form-error">{approveError.message}</p>}
        </div>
      )}

      <div className="section-title">Steps (live)</div>
      {steps.map((s: any, index: number) => (
        <div className="step-card" key={s.id}>
          <div className="step-index">{index + 1}</div>
          <div className="step-body">
            <div className="step-title">{s.step_name}</div>
            <div className="step-meta">
              <span className="type-chip">{s.step_type}</span>
              <StatusBadge status={s.status} />
              {s.attempts > 1 && <span>attempt {s.attempts}</span>}
              {duration(s.started_at, s.finished_at) && (
                <span>{duration(s.started_at, s.finished_at)}</span>
              )}
              {s.approved_at && <span>approved {new Date(s.approved_at).toLocaleTimeString()}</span>}
            </div>
            {s.error && <p className="form-error">{s.error}</p>}
            {(s.input || s.output) && (
              <details>
                <summary>input / output</summary>
                <Pretty value={s.input} />
                <Pretty value={s.output} />
              </details>
            )}
          </div>
        </div>
      ))}
      {steps.length === 0 && <div className="empty">Waiting for step data…</div>}
    </Layout>
  )
}
