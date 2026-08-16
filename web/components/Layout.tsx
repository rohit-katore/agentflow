import { useSubscription } from '@apollo/client'
import { useAuthenticationStatus, useSignOut, useUserEmail } from '@nhost/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useOrg } from '../lib/org'
import { ORG_QUOTA_SUB } from '../lib/queries'

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuthenticationStatus()
  const { signOut } = useSignOut()
  const email = useUserEmail()
  const { org, orgs, selectOrg } = useOrg()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login')
  }, [isLoading, isAuthenticated, router])

  const { data } = useSubscription(ORG_QUOTA_SUB, {
    variables: { orgId: org?.id },
    skip: !org,
  })

  if (isLoading || !isAuthenticated) {
    return <div className="page-loading">Loading…</div>
  }

  const quota = data?.organizations_by_pk
  const used = quota?.quota_used ?? 0
  const limit = quota?.quota_limit ?? 0
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const stats = quota?.usage_stats
  const quotaTitle = stats
    ? `${stats.runs_this_month ?? 0} runs this month · ${stats.completed_this_month ?? 0} completed · ${
        stats.failed_this_month ?? 0
      } failed · avg ${
        stats.avg_run_seconds_this_month != null
          ? Number(stats.avg_run_seconds_this_month).toFixed(1) + 's'
          : '–'
      }`
    : 'No runs yet this month'

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            AgentFlow
          </Link>
          {orgs.length > 0 && (
            <select
              className="org-select"
              value={org?.id ?? ''}
              onChange={(e) => selectOrg(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.role}
                </option>
              ))}
            </select>
          )}
          {org && quota && (
            <div className="quota" title={quotaTitle}>
              <div className="quota-bar">
                <div
                  className={`quota-fill${used >= limit ? ' full' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="quota-label">
                {used}/{limit} runs
              </span>
            </div>
          )}
          <nav className="nav">
            <Link href="/">Workflows</Link>
            <Link href="/settings/members">Members</Link>
          </nav>
          <div className="user">
            <span className="user-email">{email}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void signOut().then(() => router.push('/login'))
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  )
}
