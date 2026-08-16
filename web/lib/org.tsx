import { useQuery } from '@apollo/client'
import { useAuthenticationStatus } from '@nhost/react'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { MY_ORGS } from './queries'

export type OrgInfo = { id: string; name: string; role: string }

type OrgContextValue = {
  orgs: OrgInfo[]
  org: OrgInfo | null
  loading: boolean
  selectOrg: (id: string) => void
  refetchOrgs: () => void
}

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  org: null,
  loading: true,
  selectOrg: () => {},
  refetchOrgs: () => {},
})

const STORAGE_KEY = 'agentflow.org'

export function OrgProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthenticationStatus()
  const { data, loading, refetch } = useQuery(MY_ORGS, { skip: !isAuthenticated })
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setSelected(window.localStorage.getItem(STORAGE_KEY))
  }, [])

  const orgs: OrgInfo[] = useMemo(
    () =>
      (data?.org_members ?? []).map((m: any) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
    [data]
  )

  const org = orgs.find((o) => o.id === selected) ?? orgs[0] ?? null

  const selectOrg = (id: string) => {
    setSelected(id)
    window.localStorage.setItem(STORAGE_KEY, id)
  }

  const value = useMemo<OrgContextValue>(
    () => ({
      orgs,
      org,
      loading: loading && orgs.length === 0,
      selectOrg,
      refetchOrgs: () => {
        void refetch()
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgs, org, loading, refetch]
  )

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg() {
  return useContext(OrgContext)
}
