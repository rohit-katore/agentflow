import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuthenticationStatus, useSignUpEmailPassword } from '@nhost/react'

export default function Register() {
  const router = useRouter()
  const { isAuthenticated } = useAuthenticationStatus()
  const { signUpEmailPassword, isLoading, error } = useSignUpEmailPassword()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (isAuthenticated) router.replace('/')
  }, [isAuthenticated, router])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const result = await signUpEmailPassword(email, password)
    if (result.isSuccess) router.push('/')
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1 className="brand">AgentFlow</h1>
        <p className="muted">Create an account, then create an organization or ask an owner to add you.</p>
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
          <span>Password (9+ characters)</span>
          <input
            className="input"
            type="password"
            minLength={9}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="form-error">{error.message}</p>}
        <button className="btn btn-primary" disabled={isLoading} type="submit">
          {isLoading ? 'Creating account…' : 'Create account'}
        </button>
        <p className="muted">
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </div>
  )
}
