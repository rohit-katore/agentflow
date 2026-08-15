import { adminGql, AppError } from './hasura'
import { RunContext, renderTemplate, renderDeep } from './template'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type RunRow = {
  id: string
  org_id: string
  workflow_id: string
  status: string
  trigger_payload: any
}

export type StepRunRow = {
  id: string
  run_id: string
  step_order: number
  step_type: string
  step_name: string
  config: Record<string, any>
  status: string
  output: any
  attempts: number
}

export async function execLlmCall(config: any, ctx: RunContext) {
  const prompt = renderTemplate(String(config.prompt || ''), ctx)
  if (!prompt) throw new AppError('llm_call step has an empty prompt', 422)

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    // Disclosed stub: without GROQ_API_KEY we simulate the provider with an
    // artificial delay so runs still stream step by step in the demo.
    await sleep(1200)
    return {
      text: `APPROVE - stubbed LLM output (set GROQ_API_KEY for real calls). Prompt was: ${prompt.slice(0, 160)}`,
      model: 'stub',
      stubbed: true,
    }
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'llama-3.1-8b-instant',
      messages: [
        ...(config.system
          ? [{ role: 'system', content: renderTemplate(String(config.system), ctx) }]
          : []),
        { role: 'user', content: prompt },
      ],
      temperature: config.temperature ?? 0.2,
      max_tokens: config.max_tokens ?? 500,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`groq returned ${res.status}: ${body.slice(0, 200)}`)
  }
  const json: any = await res.json()
  const text = json.choices?.[0]?.message?.content ?? ''
  return { text, model: json.model, usage: json.usage }
}

export async function execHttpRequest(config: any, ctx: RunContext) {
  const url = renderTemplate(String(config.url || ''), ctx)
  if (!/^https?:\/\//.test(url)) {
    throw new AppError('http_request step needs an absolute http(s) url', 422)
  }
  const method = String(config.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { ...(renderDeep(config.headers, ctx) || {}) }

  let body: string | undefined
  if (config.body !== undefined && config.body !== null && method !== 'GET') {
    body =
      typeof config.body === 'string'
        ? renderTemplate(config.body, ctx)
        : JSON.stringify(renderDeep(config.body, ctx))
    if (!headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/json'
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeout_ms ?? 15000)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal })
    const raw = await res.text()
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      // keep as text
    }
    if (!res.ok && !config.allow_failure) {
      throw new Error(`request to ${url} returned ${res.status}`)
    }
    return {
      status: res.status,
      ok: res.ok,
      body: typeof parsed === 'string' ? parsed.slice(0, 4000) : parsed,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function execDbWrite(config: any, ctx: RunContext, run: RunRow, stepRunId: string) {
  const key = renderTemplate(String(config.key || 'result'), ctx)
  let value: unknown
  if (typeof config.value === 'string') {
    const rendered = renderTemplate(config.value, ctx)
    try {
      value = JSON.parse(rendered)
    } catch {
      value = rendered
    }
  } else if (config.value !== undefined) {
    value = renderDeep(config.value, ctx)
  } else {
    value = ctx.prev ?? null
  }

  const data = await adminGql<{ insert_artifacts_one: { id: string } }>(
    `mutation ($object: artifacts_insert_input!) {
      insert_artifacts_one(object: $object) { id }
    }`,
    { object: { org_id: run.org_id, run_id: run.id, step_run_id: stepRunId, key, value } }
  )
  return { artifact_id: data.insert_artifacts_one.id, key }
}

export async function execNotify(config: any, ctx: RunContext, run: RunRow, stepRunId: string) {
  const message = renderTemplate(String(config.message || 'Workflow update'), ctx)
  const channel = config.channel === 'log' ? 'log' : 'slack'
  const data = await adminGql<{ insert_notifications_one: { id: string } }>(
    `mutation ($object: notifications_insert_input!) {
      insert_notifications_one(object: $object) { id }
    }`,
    { object: { org_id: run.org_id, run_id: run.id, step_run_id: stepRunId, channel, message } }
  )
  // Delivery is out of band: the notification_created event trigger calls
  // /hooks/notify, which pushes to Slack (or records it as logged).
  return { notification_id: data.insert_notifications_one.id, channel, queued: true }
}

export function execConditionalBranch(config: any, ctx: RunContext) {
  const input = renderTemplate(String(config.input ?? '{{prev.text}}'), ctx)
  const operator = String(config.operator || 'contains')
  const expected = String(config.value ?? '')

  let matched: boolean
  switch (operator) {
    case 'contains':
      matched = input.toLowerCase().includes(expected.toLowerCase())
      break
    case 'not_contains':
      matched = !input.toLowerCase().includes(expected.toLowerCase())
      break
    case 'starts_with':
      matched = input.trim().toLowerCase().startsWith(expected.toLowerCase())
      break
    case 'equals':
      matched = input.trim() === expected.trim()
      break
    case 'not_equals':
      matched = input.trim() !== expected.trim()
      break
    case 'gt':
      matched = parseFloat(input) > parseFloat(expected)
      break
    case 'lt':
      matched = parseFloat(input) < parseFloat(expected)
      break
    case 'is_empty':
      matched = input.trim().length === 0
      break
    default:
      throw new AppError(`Unknown operator "${operator}" in conditional_branch`, 422)
  }

  const ifFalse = config.if_false === 'end_run' ? 'end_run' : 'skip_next'
  const skipCount = Math.max(1, parseInt(config.skip_count, 10) || 1)
  return {
    input: input.slice(0, 500),
    operator,
    value: expected,
    matched,
    action: matched ? 'continue' : ifFalse,
    skip_count: matched ? 0 : ifFalse === 'skip_next' ? skipCount : 0,
  }
}
