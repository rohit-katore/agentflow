import { useState } from 'react'

type Props = {
  type: string
  config: Record<string, any>
  onChange: (config: Record<string, any>) => void
}

const TEMPLATE_HINT = 'Templates: {{trigger.field}}, {{prev.text}}, {{steps.step_name.text}}'

function JsonField({
  label,
  hint,
  initial,
  onValid,
  rows = 3,
  allowPlainText = false,
}: {
  label: string
  hint?: string
  initial: any
  onValid: (value: any) => void
  rows?: number
  allowPlainText?: boolean
}) {
  const [text, setText] = useState<string>(() => {
    if (initial === undefined || initial === null) return ''
    return typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2)
  })
  const [invalid, setInvalid] = useState(false)

  const handle = (value: string) => {
    setText(value)
    const trimmed = value.trim()
    if (!trimmed) {
      setInvalid(false)
      onValid(allowPlainText ? '' : null)
      return
    }
    try {
      onValid(JSON.parse(trimmed))
      setInvalid(false)
    } catch {
      if (allowPlainText) {
        onValid(value)
        setInvalid(false)
      } else {
        setInvalid(true)
      }
    }
  }

  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        className={`input${invalid ? ' input-error' : ''}`}
        rows={rows}
        value={text}
        onChange={(e) => handle(e.target.value)}
      />
      {invalid ? (
        <small className="field-error">Not valid JSON yet — keeping the last valid value</small>
      ) : hint ? (
        <small className="field-hint">{hint}</small>
      ) : null}
    </label>
  )
}

export default function StepConfigForm({ type, config, onChange }: Props) {
  const set = (patch: Record<string, any>) => onChange({ ...config, ...patch })

  if (type === 'llm_call') {
    return (
      <>
        <label className="field">
          <span>Prompt</span>
          <textarea
            className="input"
            rows={4}
            value={config.prompt ?? ''}
            onChange={(e) => set({ prompt: e.target.value })}
          />
          <small className="field-hint">{TEMPLATE_HINT}</small>
        </label>
        <div className="row">
          <label className="field">
            <span>Model</span>
            <input
              className="input"
              value={config.model ?? ''}
              placeholder="llama-3.1-8b-instant"
              onChange={(e) => set({ model: e.target.value })}
            />
          </label>
          <label className="field">
            <span>System prompt (optional)</span>
            <input
              className="input"
              value={config.system ?? ''}
              onChange={(e) => set({ system: e.target.value })}
            />
          </label>
        </div>
      </>
    )
  }

  if (type === 'http_request') {
    return (
      <>
        <div className="row">
          <label className="field grow">
            <span>URL</span>
            <input
              className="input"
              value={config.url ?? ''}
              placeholder="https://api.example.com/things"
              onChange={(e) => set({ url: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Method</span>
            <select
              className="input"
              value={config.method ?? 'GET'}
              onChange={(e) => set({ method: e.target.value })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <JsonField
          label="Headers (JSON, optional)"
          initial={config.headers}
          onValid={(headers) => set({ headers })}
          rows={2}
        />
        <JsonField
          label="Body (JSON or text, optional)"
          hint={TEMPLATE_HINT}
          initial={config.body}
          onValid={(body) => set({ body })}
          allowPlainText
        />
      </>
    )
  }

  if (type === 'db_write') {
    return (
      <>
        <label className="field">
          <span>Artifact key</span>
          <input
            className="input"
            value={config.key ?? ''}
            placeholder="lead_assessment"
            onChange={(e) => set({ key: e.target.value })}
          />
        </label>
        <JsonField
          label="Value (JSON or template text)"
          hint={`Defaults to the previous step's output. ${TEMPLATE_HINT}`}
          initial={config.value}
          onValid={(value) => set({ value })}
          allowPlainText
        />
      </>
    )
  }

  if (type === 'notify') {
    return (
      <>
        <label className="field">
          <span>Channel</span>
          <select
            className="input"
            value={config.channel ?? 'slack'}
            onChange={(e) => set({ channel: e.target.value })}
          >
            <option value="slack">Slack (incoming webhook)</option>
            <option value="log">Log only</option>
          </select>
        </label>
        <label className="field">
          <span>Message</span>
          <textarea
            className="input"
            rows={3}
            value={config.message ?? ''}
            onChange={(e) => set({ message: e.target.value })}
          />
          <small className="field-hint">{TEMPLATE_HINT}</small>
        </label>
      </>
    )
  }

  if (type === 'conditional_branch') {
    return (
      <>
        <div className="row">
          <label className="field grow">
            <span>Input</span>
            <input
              className="input"
              value={config.input ?? '{{prev.text}}'}
              onChange={(e) => set({ input: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Operator</span>
            <select
              className="input"
              value={config.operator ?? 'contains'}
              onChange={(e) => set({ operator: e.target.value })}
            >
              {[
                'contains',
                'not_contains',
                'starts_with',
                'equals',
                'not_equals',
                'gt',
                'lt',
                'is_empty',
              ].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Value</span>
            <input
              className="input"
              value={config.value ?? ''}
              onChange={(e) => set({ value: e.target.value })}
            />
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>If it does not match</span>
            <select
              className="input"
              value={config.if_false ?? 'end_run'}
              onChange={(e) => set({ if_false: e.target.value })}
            >
              <option value="end_run">End the run (skip the rest)</option>
              <option value="skip_next">Skip the next step(s)</option>
            </select>
          </label>
          {config.if_false === 'skip_next' && (
            <label className="field">
              <span>Steps to skip</span>
              <input
                className="input"
                type="number"
                min={1}
                value={config.skip_count ?? 1}
                onChange={(e) => set({ skip_count: Number(e.target.value) })}
              />
            </label>
          )}
        </div>
      </>
    )
  }

  if (type === 'approval_gate') {
    return (
      <>
        <label className="field">
          <span>Note for the approver</span>
          <textarea
            className="input"
            rows={2}
            value={config.note ?? ''}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Who can approve</span>
          <select
            className="input"
            value={config.require_role ?? 'editor'}
            onChange={(e) => set({ require_role: e.target.value })}
          >
            <option value="editor">Org owner or editor</option>
            <option value="owner">Org owner only</option>
          </select>
        </label>
      </>
    )
  }

  return (
    <JsonField
      label="Config (JSON)"
      initial={config}
      onValid={(value) =>
        onChange(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
      }
      rows={4}
    />
  )
}
