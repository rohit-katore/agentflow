import { useMutation, useQuery } from '@apollo/client'
import Link from 'next/link'
import { useRouter } from 'next/router'
import type { FormEvent } from 'react'
import { useState } from 'react'
import Layout from '../../components/Layout'
import StatusBadge from '../../components/StatusBadge'
import StepConfigForm from '../../components/StepConfigForm'
import { useOrg } from '../../lib/org'
import {
  ADD_STEP,
  ADD_TRIGGER,
  DELETE_STEP,
  DELETE_TRIGGER,
  INSERT_INBOUND_EVENT,
  REVEAL_WEBHOOK_KEY,
  SWAP_STEPS,
  TRIGGER_RUN,
  UPDATE_STEP,
  UPDATE_TRIGGER,
  UPDATE_WORKFLOW,
  WORKFLOW_DETAIL,
} from '../../lib/queries'

const STEP_TYPES = [
  { value: 'llm_call', label: 'LLM call' },
  { value: 'http_request', label: 'HTTP request' },
  { value: 'conditional_branch', label: 'Conditional branch' },
  { value: 'approval_gate', label: 'Approval gate' },
  { value: 'db_write', label: 'DB write (artifact)', ownerOnly: true },
  { value: 'notify', label: 'Notify', ownerOnly: true },
]

function StepEditor({
  step,
  onSaved,
  onCancel,
}: {
  step: any
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState<string>(step.name)
  const [config, setConfig] = useState<Record<string, any>>(step.config ?? {})
  const [updateStep, { loading, error }] = useMutation(UPDATE_STEP)

  const save = async () => {
    await updateStep({ variables: { id: step.id, name, config } })
    onSaved()
  }

  return (
    <div>
      <label className="field">
        <span>Step name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <StepConfigForm type={step.type} config={config} onChange={setConfig} />
      {error && <p className="form-error">{error.message}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={loading} onClick={save}>
          {loading ? 'Saving…' : 'Save step'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function WorkflowBuilder() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const { orgs } = useOrg()

  const { data, loading, refetch } = useQuery(WORKFLOW_DETAIL, {
    variables: { id },
    skip: !id,
  })

  const [swapSteps] = useMutation(SWAP_STEPS)
  const [deleteStep] = useMutation(DELETE_STEP)
  const [addStep, { loading: addingStep, error: addStepError }] = useMutation(ADD_STEP)
  const [addTrigger, { loading: addingTrigger, error: addTriggerError }] =
    useMutation(ADD_TRIGGER)
  const [updateTrigger] = useMutation(UPDATE_TRIGGER)
  const [deleteTrigger] = useMutation(DELETE_TRIGGER)
  const [updateWorkflow] = useMutation(UPDATE_WORKFLOW)
  const [revealKey] = useMutation(REVEAL_WEBHOOK_KEY)
  const [insertEvent, { loading: insertingEvent }] = useMutation(INSERT_INBOUND_EVENT)
  const [triggerRun, { loading: running, error: runError }] = useMutation(TRIGGER_RUN)

  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [newStepType, setNewStepType] = useState('llm_call')
  const [newStepName, setNewStepName] = useState('')
  const [newStepConfig, setNewStepConfig] = useState<Record<string, any>>({})
  const [newTriggerType, setNewTriggerType] = useState('webhook')
  const [newTriggerCron, setNewTriggerCron] = useState('*/5 * * * *')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [revealError, setRevealError] = useState<string | null>(null)
  const [payload, setPayload] = useState('{"lead": "Jane from Initech wants 500 seats for the fall rollout"}')
  const [eventNote, setEventNote] = useState<string | null>(null)

  const wf = data?.workflows_by_pk
  const role = wf ? orgs.find((o) => o.id === wf.org_id)?.role : undefined
  const canEdit = role === 'owner' || role === 'editor'
  const isOwner = role === 'owner'

  if (!id || loading) {
    return (
      <Layout>
        <div className="page-loading">Loading workflow…</div>
      </Layout>
    )
  }

  if (!wf) {
    return (
      <Layout>
        <div className="empty">
          Workflow not found — it may belong to an organization you are not a member of.
        </div>
      </Layout>
    )
  }

  const steps = wf.steps ?? []
  const triggers = wf.triggers ?? []
  const hasDbEventTrigger = triggers.some((t: any) => t.type === 'db_event' && t.is_enabled)

  const move = async (index: number, dir: -1 | 1) => {
    const a = steps[index]
    const b = steps[index + dir]
    if (!a || !b) return
    await swapSteps({
      variables: { idA: a.id, orderA: b.step_order, idB: b.id, orderB: a.step_order },
    })
    await refetch()
  }

  const submitStep = async (e: FormEvent) => {
    e.preventDefault()
    const fallback = STEP_TYPES.find((t) => t.value === newStepType)?.label ?? newStepType
    await addStep({
      variables: {
        object: {
          workflow_id: wf.id,
          step_order: (steps[steps.length - 1]?.step_order ?? 0) + 1,
          type: newStepType,
          name: newStepName.trim() || fallback,
          config: newStepConfig,
        },
      },
    })
    setNewStepName('')
    setNewStepConfig({})
    await refetch()
  }

  const submitTrigger = async (e: FormEvent) => {
    e.preventDefault()
    await addTrigger({
      variables: {
        object: {
          workflow_id: wf.id,
          type: newTriggerType,
          config: newTriggerType === 'schedule' ? { cron: newTriggerCron } : {},
        },
      },
    })
    await refetch()
  }

  const reveal = async (triggerId: string) => {
    setRevealError(null)
    try {
      const result = await revealKey({ variables: { triggerId } })
      const url = result.data?.revealWebhookKey?.webhook_url
      if (url) setRevealed((prev) => ({ ...prev, [triggerId]: url }))
    } catch (err: any) {
      setRevealError(err?.message ?? 'Could not reveal the webhook URL')
    }
  }

  const run = async () => {
    let parsed: any = {}
    if (payload.trim()) {
      try {
        parsed = JSON.parse(payload)
      } catch {
        parsed = { text: payload }
      }
    }
    const result = await triggerRun({ variables: { workflowId: wf.id, payload: parsed } })
    const runId = result.data?.triggerWorkflowRun?.run_id
    if (runId) router.push(`/runs/${runId}`)
  }

  const simulateEvent = async () => {
    setEventNote(null)
    let parsed: any = {}
    if (payload.trim()) {
      try {
        parsed = JSON.parse(payload)
      } catch {
        parsed = { text: payload }
      }
    }
    const result = await insertEvent({
      variables: { orgId: wf.org_id, source: 'demo-console', payload: parsed },
    })
    if (result.data?.insert_inbound_events_one?.id) {
      setEventNote(
        'Event row inserted — the Hasura event trigger is starting the run. Check “Recent runs” in a moment.'
      )
    }
  }

  return (
    <Layout>
      <div className="toolbar">
        <div>
          <h1 className="page-title">{wf.name}</h1>
          <p className="muted">
            {wf.description || 'No description'} · your role: <strong>{role ?? 'viewer'}</strong>
          </p>
        </div>
        <div className="spacer" />
        {canEdit && (
          <label className="field" style={{ margin: 0 }}>
            <span>Active</span>
            <input
              type="checkbox"
              checked={wf.is_active}
              onChange={(e) =>
                updateWorkflow({
                  variables: { id: wf.id, set: { is_active: e.target.checked } },
                }).then(() => refetch())
              }
            />
          </label>
        )}
      </div>

      {canEdit && (
        <div className="card">
          <h3>Run this workflow</h3>
          <label className="field">
            <span>Trigger payload (JSON, available as {'{{trigger.*}}'} in steps)</span>
            <textarea
              className="input"
              rows={2}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={running} onClick={run}>
              {running ? 'Starting…' : '▶ Run now'}
            </button>
            {hasDbEventTrigger && (
              <button className="btn" disabled={insertingEvent} onClick={simulateEvent}>
                {insertingEvent ? 'Inserting…' : 'Simulate DB event'}
              </button>
            )}
          </div>
          {runError && <p className="form-error">{runError.message}</p>}
          {eventNote && <p className="muted">{eventNote}</p>}
        </div>
      )}

      <div className="section-title">Steps (run top to bottom)</div>
      {steps.length === 0 && <div className="empty">No steps yet.</div>}
      {steps.map((step: any, index: number) => (
        <div className="step-card" key={step.id}>
          <div className="step-index">{index + 1}</div>
          <div className="step-body">
            <div className="step-title">{step.name}</div>
            <div className="step-meta">
              <span className="type-chip">{step.type}</span>
              {step.type === 'llm_call' && <span>{step.config?.model || 'llama-3.1-8b-instant'}</span>}
              {step.type === 'http_request' && (
                <span>
                  {(step.config?.method || 'GET') + ' '}
                  {step.config?.url || 'no url set'}
                </span>
              )}
              {step.type === 'conditional_branch' && (
                <span>
                  {step.config?.operator || 'contains'} “{step.config?.value ?? ''}” →{' '}
                  {step.config?.if_false === 'skip_next' ? 'skip next' : 'end run'}
                </span>
              )}
              {step.type === 'approval_gate' && (
                <span>approver: {step.config?.require_role === 'owner' ? 'owner only' : 'owner or editor'}</span>
              )}
            </div>
            {editingStepId === step.id && (
              <StepEditor
                step={step}
                onSaved={() => {
                  setEditingStepId(null)
                  void refetch()
                }}
                onCancel={() => setEditingStepId(null)}
              />
            )}
          </div>
          {canEdit && editingStepId !== step.id && (
            <div className="step-actions">
              <button className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={index === steps.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingStepId(step.id)}>
                Edit
              </button>
              <button
                className="btn btn-ghost btn-sm btn-danger"
                onClick={() => deleteStep({ variables: { id: step.id } }).then(() => refetch())}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="card">
          <h3>Add a step</h3>
          <form onSubmit={submitStep}>
            <div className="row">
              <label className="field">
                <span>Type</span>
                <select
                  className="input"
                  value={newStepType}
                  onChange={(e) => {
                    setNewStepType(e.target.value)
                    setNewStepConfig({})
                  }}
                >
                  {STEP_TYPES.map((t) => (
                    <option key={t.value} value={t.value} disabled={Boolean(t.ownerOnly) && !isOwner}>
                      {t.label}
                      {t.ownerOnly ? ' — owner only' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field grow">
                <span>Name</span>
                <input
                  className="input"
                  value={newStepName}
                  placeholder={STEP_TYPES.find((t) => t.value === newStepType)?.label}
                  onChange={(e) => setNewStepName(e.target.value)}
                />
              </label>
            </div>
            <StepConfigForm type={newStepType} config={newStepConfig} onChange={setNewStepConfig} />
            {addStepError && <p className="form-error">{addStepError.message}</p>}
            <button className="btn btn-primary" disabled={addingStep} type="submit">
              {addingStep ? 'Adding…' : 'Add step'}
            </button>
          </form>
        </div>
      )}

      <div className="section-title">Triggers</div>
      {triggers.length === 0 && <div className="empty">Only manual runs for now.</div>}
      {triggers.map((t: any) => (
        <div className="step-card" key={t.id}>
          <div className="step-body">
            <div className="step-title">
              <span className="type-chip">{t.type}</span>{' '}
              {t.type === 'schedule' && <span className="code">{t.config?.cron ?? ''}</span>}
            </div>
            <div className="step-meta">
              <span>{t.is_enabled ? 'enabled' : 'disabled'}</span>
              {t.last_fired_at && <span>last fired {new Date(t.last_fired_at).toLocaleString()}</span>}
              {t.type === 'db_event' && <span>fires when a row lands in inbound_events for this org</span>}
            </div>
            {t.type === 'webhook' &&
              (revealed[t.id] ? (
                <p className="code" style={{ marginTop: 6 }}>
                  {revealed[t.id]}
                </p>
              ) : (
                canEdit && (
                  <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => reveal(t.id)}>
                    Reveal webhook URL
                  </button>
                )
              ))}
          </div>
          {canEdit && (
            <div className="step-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  updateTrigger({
                    variables: { id: t.id, set: { is_enabled: !t.is_enabled } },
                  }).then(() => refetch())
                }
              >
                {t.is_enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                className="btn btn-ghost btn-sm btn-danger"
                onClick={() => deleteTrigger({ variables: { id: t.id } }).then(() => refetch())}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="card">
          <h3>Attach a trigger</h3>
          <form className="row" onSubmit={submitTrigger}>
            <label className="field">
              <span>Type</span>
              <select
                className="input"
                value={newTriggerType}
                onChange={(e) => setNewTriggerType(e.target.value)}
              >
                <option value="webhook" disabled={!isOwner}>
                  Webhook {isOwner ? '' : '— owner only'}
                </option>
                <option value="schedule">Schedule (cron)</option>
                <option value="db_event">Database event</option>
              </select>
            </label>
            {newTriggerType === 'schedule' && (
              <label className="field">
                <span>Cron expression</span>
                <input
                  className="input"
                  value={newTriggerCron}
                  onChange={(e) => setNewTriggerCron(e.target.value)}
                />
              </label>
            )}
            <button className="btn btn-primary" disabled={addingTrigger} type="submit">
              {addingTrigger ? 'Attaching…' : 'Attach trigger'}
            </button>
          </form>
          {addTriggerError && <p className="form-error">{addTriggerError.message}</p>}
          <p className="muted">
            Webhook triggers get a secret key generated by the database; reveal the URL above and
            POST any JSON to it. Schedule triggers are fired by a Hasura cron job every minute.
            Database-event triggers start the workflow whenever a row is inserted into this
            org’s <span className="code">inbound_events</span> table (via the Hasura event trigger).
          </p>
        </div>
      )}

      <div className="section-title">Recent runs</div>
      {(wf.runs ?? []).length === 0 ? (
        <div className="empty">This workflow has not run yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Via</th>
              <th>Started</th>
              <th>Error</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {wf.runs.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.triggered_via}</td>
                <td>{r.started_at ? new Date(r.started_at).toLocaleString() : '–'}</td>
                <td className="muted">{r.error ?? ''}</td>
                <td>
                  <Link href={`/runs/${r.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>
          Refresh
        </button>{' '}
        Live step-by-step progress streams on each run’s page.
      </p>
    </Layout>
  )
}
