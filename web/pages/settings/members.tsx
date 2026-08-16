import { useMutation, useQuery } from '@apollo/client'
import { useUserId } from '@nhost/react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import Layout from '../../components/Layout'
import { useOrg } from '../../lib/org'
import { ADD_MEMBER, ORG_MEMBERS, REMOVE_MEMBER, UPDATE_MEMBER_ROLE } from '../../lib/queries'

const ROLES = ['owner', 'editor', 'viewer'] as const

export default function MembersPage() {
  const { org } = useOrg()
  const userId = useUserId()
  const isOwner = org?.role === 'owner'

  const { data, loading, refetch } = useQuery(ORG_MEMBERS, {
    variables: { orgId: org?.id },
    skip: !org,
  })
  const [addMember, { loading: adding, error: addError }] = useMutation(ADD_MEMBER)
  const [updateRole] = useMutation(UPDATE_MEMBER_ROLE)
  const [removeMember] = useMutation(REMOVE_MEMBER)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('editor')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!org || !email.trim()) return
    await addMember({ variables: { orgId: org.id, email: email.trim(), role } })
    setEmail('')
    await refetch()
  }

  const members = data?.org_members ?? []

  return (
    <Layout>
      <h1 className="page-title">Members</h1>
      <p className="page-subtitle">
        {org ? `${org.name} · your role: ${org.role}` : 'Select an organization first.'}
      </p>

      {org && isOwner && (
        <div className="card">
          <h3>Add a member</h3>
          <p className="muted">
            The person must have signed up already. Only owners can manage members — editors and
            viewers cannot.
          </p>
          <form className="row" onSubmit={submit}>
            <label className="field grow">
              <span>Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Role</span>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" disabled={adding} type="submit">
              {adding ? 'Adding…' : 'Add member'}
            </button>
          </form>
          {addError && <p className="form-error">{addError.message}</p>}
        </div>
      )}

      <div className="section-title">Roster</div>
      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : members.length === 0 ? (
        <div className="empty">No members found.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Added</th>
              {isOwner && <th></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m: any) => {
              const isSelf = m.user_id === userId
              return (
                <tr key={m.id}>
                  <td>
                    {m.member_email ?? m.user_id}
                    {isSelf && <span className="muted"> (you)</span>}
                  </td>
                  <td>
                    {isOwner && !isSelf ? (
                      <select
                        className="input"
                        value={m.role}
                        onChange={(e) =>
                          updateRole({ variables: { id: m.id, role: e.target.value } }).then(() =>
                            refetch()
                          )
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  <td>{m.created_at ? new Date(m.created_at).toLocaleDateString() : '–'}</td>
                  {isOwner && (
                    <td>
                      {!isSelf && (
                        <button
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() =>
                            removeMember({ variables: { id: m.id } }).then(() => refetch())
                          }
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ marginTop: 16 }}>
        Roles: <strong>owner</strong> — full control including members and owner-only step types;{' '}
        <strong>editor</strong> — build and run workflows; <strong>viewer</strong> — read-only,
        cannot trigger or approve.
      </p>
    </Layout>
  )
}
