import { useMutation, useQuery, useSubscription } from '@apollo/client'
import Link from 'next/link'
import type { FormEvent } from 'react'
import { useState } from 'react'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import { useOrg } from '../lib/org'
import { CREATE_ORG, CREATE_WORKFLOW, ORG_OVERVIEW, RECENT_RUNS_SUB } from '../lib/queries'

function CreateOrgCard({ standalone }: { standalone: boolean }) {
  const { refetchOrgs, selectOrg } = useOrg()
  const [name, setName] = useState('')
  const [createOrg, { loading, error }] = useMutation(CREATE_ORG)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const result = await createOrg({ variables: { name: name.trim() } })
    const id = result.data?.insert_organizations_one?.id
    if (id) {
      selectOrg(id)
      refetchOrgs()
      setName('')
    }
  }

  return (
    <div className="card">
      {standalone && (
        <>
          <h3>Create your organization</h3>
          <p className="muted">
            Workflows, runs and quotas all live inside an organization. You will be its owner and
            can invite editors and viewers from the Members page.
          </p>
        </>
      )}
      <form className="row" onSubmit={submit}>
        <label className="field grow">
          <span>Organization name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Research"
            required
          />
        </label>
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? 'Creating…' : 'Create organization'}
        </button>
      </form>
      {error && <p className="form-error">{error.message}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { org, loading: orgLoading } = useOrg()
  const canEdit = org?.role === 'owner' || org?.role === 'editor'

  const { data, loading, refetch } = useQuery(ORG_OVERVIEW, {
    variables: { orgId: org?.id },
    skip: !org,
  })
  const { data: runsData } = useSubscription(RECENT_RUNS_SUB, {
    variables: { orgId: org?.id },
    skip: !org,
  })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [createWorkflow, { loading: creating, error: createError }] =
    useMutation(CREATE_WORKFLOW)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!org || !name.trim()) return
    await createWorkflow({
      variables: { orgId: org.id, name: name.trim(), description: description.trim() || null },
    })
    setName('')
    setDescription('')
    await refetch()
  }

  const workflows = data?.workflows ?? []
  const runs = runsData?.workflow_runs ?? []

  return (
    <Layout>
      {!org ? (
        orgLoading ? (
          <div className="page-loading">Loading organizations…</div>
        ) : (
          <CreateOrgCard standalone />
        )
      ) : (
        <>
          <h1 className="page-title">Workflows</h1>
          <p className="page-subtitle">
            {org.name} · your role: <strong>{org.role}</strong>
          </p>

          {canEdit && (
            <div className="card">
              <form className="row" onSubmit={submit}>
                <label className="field grow">
                  <span>New workflow name</span>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Lead qualifier"
                    required
                  />
                </label>
                <label className="field grow">
                  <span>Description (optional)</span>
                  <input
                    className="input"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <button className="btn btn-primary" disabled={creating} type="submit">
                  {creating ? 'Creating…' : 'Create workflow'}
                </button>
              </form>
              {createError && <p className="form-error">{createError.message}</p>}
            </div>
          )}

          <div className="section-title">All workflows</div>
          {loading ? (
            <div className="page-loading">Loading…</div>
          ) : workflows.length === 0 ? (
            <div className="empty">
              No workflows yet{canEdit ? ' — create one above to get started.' : '.'}
            </div>
          ) : (
            <div className="grid">
              {workflows.map((wf: any) => (
                <div className="card" key={wf.id}>
                  <h3>
                    <Link href={`/workflows/${wf.id}`}>{wf.name}</Link>{' '}
                    {!wf.is_active && <span className="badge">disabled</span>}
                  </h3>
                  {wf.description && <p className="muted">{wf.description}</p>}
                  <p className="step-meta">
                    {wf.steps.length} step{wf.steps.length === 1 ? '' : 's'}
                    {wf.steps.slice(0, 4).map((s: any) => (
                      <span className="type-chip" key={s.id}>
                        {s.type}
                      </span>
                    ))}
                    {wf.steps.length > 4 && <span>…</span>}
                  </p>
                  <p className="step-meta">
                    {wf.triggers.length === 0
                      ? 'manual only'
                      : wf.triggers.map((t: any) => (
                          <span className="type-chip" key={t.id}>
                            {t.type}
                            {!t.is_enabled && ' (off)'}
                          </span>
                        ))}
                  </p>
                  <p className="step-meta">
                    Latest run:{' '}
                    {wf.runs[0] ? (
                      <>
                        <StatusBadge status={wf.runs[0].status} />
                        <Link href={`/runs/${wf.runs[0].id}`}>open</Link>
                      </>
                    ) : (
                      'never run'
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="section-title">Recent runs (live)</div>
          {runs.length === 0 ? (
            <div className="empty">Runs will stream here as they happen.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Via</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.workflow?.name ?? '–'}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>{r.triggered_via}</td>
                    <td>{r.started_at ? new Date(r.started_at).toLocaleString() : '–'}</td>
                    <td>
                      <Link href={`/runs/${r.id}`}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <details style={{ marginTop: 28 }}>
            <summary>Create another organization</summary>
            <CreateOrgCard standalone={false} />
          </details>
        </>
      )}
    </Layout>
  )
}
