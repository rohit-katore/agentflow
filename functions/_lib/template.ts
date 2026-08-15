export type RunContext = {
  trigger: unknown
  steps: Record<string, unknown>
  prev: unknown
}

// "Classify lead" -> "classify_lead", used as the key for {{steps.<key>.*}}
export function stepKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function lookup(ctx: RunContext, path: string): unknown {
  const parts = path.trim().split('.')
  let cur: any = ctx
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

// Resolves {{trigger.x}} / {{steps.some_step.text}} / {{prev.text}} inside
// step config strings. Unknown paths resolve to an empty string.
export function renderTemplate(template: string, ctx: RunContext): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, path: string) => {
    const value = lookup(ctx, path)
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  })
}

export function renderDeep<T>(value: T, ctx: RunContext): T {
  if (typeof value === 'string') return renderTemplate(value, ctx) as unknown as T
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = renderDeep(v, ctx)
    }
    return out as unknown as T
  }
  return value
}
