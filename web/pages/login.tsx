import { useAuthenticationStatus, useSignInEmailPassword } from '@nhost/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

export default function Login() {
  const router = useRouter()
  const { isAuthenticated } = useAuthenticationStatus()
  const { signInEmailPassword, isLoading, error } = useSignInEmailPassword()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (isAuthenticated) router.replace('/')
  }, [isAuthenticated, router])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const result = await signInEmailPassword(email, password)
    if (result.isSuccess) router.push('/')
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1 className="brand">AgentFlow</h1>
        <p className="muted">Chain AI agent steps into workflows your whole org can run.</p>
        <label className="field">
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
          <span>Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="form-error">{error.message}</p>}
        <button className="btn btn-primary" disabled={isLoading} type="submit">
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </form>
    </div>
  )
}
