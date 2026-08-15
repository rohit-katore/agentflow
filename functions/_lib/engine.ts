import { adminGql, AppError } from './hasura'
import { RunContext, renderTemplate, stepKey } from './template'
import {
  execConditionalBranch,
  execDbWrite,
  execHttpRequest,
  execLlmCall,
  execNotify,
  RunRow,
  StepRunRow,
} from './steps'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const RETRYABLE = new Set(['llm_call', 'http_request'])

// Rolls the quota window forward when a new month starts, then rejects the
// run if the org has no calls left.
export async function ensureQuota(orgId: string): Promise<void> {
  const data = await adminGql<{
    organizations_by_pk: {
      id: string
      quota_limit: number
      quota_used: number
      quota_period_start: string
    } | null
  }>(
    `query ($id: uuid!) {
      organizations_by_pk(id: $id) { id quota_limit quota_used quota_period_start }
    }`,
    { id: orgId }
  )
  const org = data.organizations_by_pk
  if (!org) throw new AppError('Organization not found', 404)

  const now = new Date()
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  if (org.quota_period_start < currentPeriod) {
    await adminGql(
      `mutation ($id: uuid!, $period: date!) {
        update_organizations_by_pk(
          pk_columns: {id: $id}
          _set: {quota_used: 0, quota_period_start: $period}
        ) { id }
      }`,
      { id: orgId, period: currentPeriod }
    )
    return
  }
  if (org.quota_used >= org.quota_limit) {
    throw new AppError('Monthly run quota exhausted for this organization', 429)
  }
}

type StartArgs = {
  workflowId: string
  via: 'manual' | 'webhook' | 'schedule' | 'db_event'
  userId?: string | null
  payload?: unknown
}

export async function startRun(args: StartArgs): Promise<{ runId: string; orgId: string }> {
  const data = await adminGql<{
    workflows_by_pk: {
      id: string
      org_id: string
      is_active: boolean
      steps: Array<{ id: string; step_order: number; type: string; name: string; config: any }>
    } | null
  }>(
    `query ($id: uuid!) {
      workflows_by_pk(id: $id) {
        id
        org_id
        is_active
        steps(order_by: {step_order: asc}) { id step_order type name config }
      }
    }`,
    { id: args.workflowId }
  )
  const workflow = data.workflows_by_pk
  if (!workflow) throw new AppError('Workflow not found', 404)
  if (!workflow.is_active) throw new AppError('Workflow is disabled', 422)
  if (workflow.steps.length === 0) throw new AppError('Workflow has no steps', 422)

  await ensureQuota(workflow.org_id)

  // Snapshot each step's config onto its step_run so a paused run resumes
  // with the config it started with, even if the workflow is edited meanwhile.
  const created = await adminGql<{ insert_workflow_runs_one: { id: string } }>(
    `mutation ($object: workflow_runs_insert_input!) {
      insert_workflow_runs_one(object: $object) { id }
    }`,
    {
      object: {
        workflow_id: workflow.id,
        org_id: workflow.org_id,
        status: 'running',
        triggered_via: args.via,
        triggered_by: args.userId ?? null,
        trigger_payload: args.payload ?? {},
        step_runs: {
          data: workflow.steps.map((s) => ({
            step_id: s.id,
            step_order: s.step_order,
            step_type: s.type,
            step_name: s.name,
            config: s.config ?? {},
            status: 'pending',
          })),
        },
      },
    }
  )
  return { runId: created.insert_workflow_runs_one.id, orgId: workflow.org_id }
}

async function loadRun(runId: string) {
  const data = await adminGql<{
    workflow_runs_by_pk: (RunRow & { step_runs: StepRunRow[] }) | null
  }>(
    `query ($id: uuid!) {
      workflow_runs_by_pk(id: $id) {
        id
        org_id
        workflow_id
        status
        trigger_payload
        step_runs(order_by: {step_order: asc}) {
          id run_id step_order step_type step_name config status output attempts
        }
      }
    }`,
    { id: runId }
  )
  if (!data.workflow_runs_by_pk) throw new AppError('Run not found', 404)
  return data.workflow_runs_by_pk
}

async function updateStepRun(id: string, set: Record<string, unknown>) {
  await adminGql(
    `mutation ($id: uuid!, $set: step_runs_set_input!) {
      update_step_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id }
    }`,
    { id, set }
  )
}

async function updateRun(id: string, set: Record<string, unknown>) {
  await adminGql(
    `mutation ($id: uuid!, $set: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id }
    }`,
    { id, set }
  )
}

async function skipSteps(ids: string[], reason: string) {
  if (ids.length === 0) return
  await adminGql(
    `mutation ($ids: [uuid!]!, $output: jsonb!) {
      update_step_runs(
        where: {id: {_in: $ids}, status: {_eq: "pending"}}
        _set: {status: "skipped", output: $output, finished_at: "now()"}
      ) { affected_rows }
    }`,
    { ids, output: { skipped: true, reason } }
  )
}

function previewInput(type: string, config: any, ctx: RunContext) {
  try {
    if (type === 'llm_call') {
      return {
        prompt: renderTemplate(String(config.prompt || ''), ctx).slice(0, 2000),
        model: config.model || 'llama-3.1-8b-instant',
      }
    }
    if (type === 'http_request') {
      return {
        url: renderTemplate(String(config.url || ''), ctx),
        method: String(config.method || 'GET').toUpperCase(),
      }
    }
    if (type === 'db_write') return { key: config.key ?? 'result' }
    if (type === 'notify') {
      return {
        channel: config.channel ?? 'slack',
        message: renderTemplate(String(config.message || ''), ctx).slice(0, 500),
      }
    }
    if (type === 'conditional_branch') {
      return {
        input: renderTemplate(String(config.input ?? '{{prev.text}}'), ctx).slice(0, 500),
        operator: config.operator ?? 'contains',
        value: config.value ?? '',
      }
    }
    return config
  } catch {
    return config
  }
}

async function execStep(sr: StepRunRow, config: any, ctx: RunContext, run: RunRow) {
  switch (sr.step_type) {
    case 'llm_call':
      return execLlmCall(config, ctx)
    case 'http_request':
      return execHttpRequest(config, ctx)
    case 'db_write':
      return execDbWrite(config, ctx, run, sr.id)
    case 'notify':
      return execNotify(config, ctx, run, sr.id)
    default:
      throw new AppError(`Unsupported step type "${sr.step_type}"`, 422)
  }
}

async function failRun(
  run: RunRow,
  ordered: StepRunRow[],
  index: number,
  sr: StepRunRow,
  err: unknown
) {
  const message = err instanceof Error ? err.message : String(err)
  await updateStepRun(sr.id, {
    status: 'failed',
    error: message.slice(0, 1000),
    finished_at: 'now()',
  })
  const rest = ordered
    .slice(index + 1)
    .filter((s) => s.status === 'pending')
    .map((s) => s.id)
  await skipSteps(rest, 'a previous step failed')
  await updateRun(run.id, {
    status: 'failed',
    error: `${sr.step_name}: ${message}`.slice(0, 1000),
    finished_at: 'now()',
  })
  return { status: 'failed' as const }
}

// Executes every runnable step of a run, in order. Also used to resume a run
// after an approval: completed steps are folded back into the template
// context and execution picks up at the first pending step.
export async function executeRun(runId: string): Promise<{ status: string }> {
  const run = await loadRun(runId)
  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    return { status: run.status }
  }

  const ctx: RunContext = { trigger: run.trigger_payload ?? {}, steps: {}, prev: null }
  const ordered = run.step_runs

  for (const sr of ordered) {
    if (sr.status === 'completed') {
      ctx.steps[stepKey(sr.step_name)] = sr.output
      if (sr.step_type !== 'approval_gate' && sr.step_type !== 'conditional_branch') {
        ctx.prev = sr.output
      }
    }
  }

  for (let i = 0; i < ordered.length; i++) {
    const sr = ordered[i]
    if (sr.status === 'completed' || sr.status === 'skipped') continue
    if (sr.status === 'waiting_approval') return { status: 'paused' }

    const config = sr.config || {}

    if (sr.step_type === 'approval_gate') {
      await updateStepRun(sr.id, {
        status: 'waiting_approval',
        started_at: 'now()',
        input: {
          note: config.note ?? null,
          require_role: config.require_role === 'owner' ? 'owner' : 'editor',
        },
      })
      await updateRun(run.id, { status: 'paused' })
      return { status: 'paused' }
    }

    if (sr.step_type === 'conditional_branch') {
      await updateStepRun(sr.id, {
        status: 'running',
        attempts: 1,
        started_at: 'now()',
        input: previewInput(sr.step_type, config, ctx),
      })
      let result: ReturnType<typeof execConditionalBranch>
      try {
        result = execConditionalBranch(config, ctx)
      } catch (err) {
        return failRun(run, ordered, i, sr, err)
      }
      await updateStepRun(sr.id, { status: 'completed', output: result, finished_at: 'now()' })
      ctx.steps[stepKey(sr.step_name)] = result

      if (result.action === 'end_run') {
        const rest = ordered
          .slice(i + 1)
          .filter((s) => s.status === 'pending')
          .map((s) => s.id)
        await skipSteps(rest, `"${sr.step_name}" did not match and ended the run`)
        break
      }
      if (result.action === 'skip_next' && result.skip_count > 0) {
        const targets = ordered
          .slice(i + 1)
          .filter((s) => s.status === 'pending')
          .slice(0, result.skip_count)
        await skipSteps(
          targets.map((s) => s.id),
          `skipped by "${sr.step_name}"`
        )
        for (const t of targets) t.status = 'skipped'
      }
      continue
    }

    const maxAttempts = RETRYABLE.has(sr.step_type)
      ? Math.min(5, Math.max(2, Number(config.max_attempts) || 2))
      : 1

    let output: any = null
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await updateStepRun(sr.id, {
        status: 'running',
        attempts: attempt,
        ...(attempt === 1
          ? { started_at: 'now()', input: previewInput(sr.step_type, config, ctx) }
          : {}),
      })
      try {
        output = await execStep(sr, config, ctx, run)
        lastError = null
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        // config mistakes (bad url, empty prompt) are not retryable
        if (err instanceof AppError && err.status === 422) break
        if (attempt < maxAttempts) await sleep(600 * attempt)
      }
    }

    if (lastError) return failRun(run, ordered, i, sr, lastError)

    await updateStepRun(sr.id, { status: 'completed', output, finished_at: 'now()' })
    ctx.steps[stepKey(sr.step_name)] = output
    ctx.prev = output
  }

  await updateRun(run.id, { status: 'completed', finished_at: 'now()' })
  await adminGql(
    `mutation ($id: uuid!) {
      update_organizations_by_pk(pk_columns: {id: $id}, _inc: {quota_used: 1}) { id }
    }`,
    { id: run.org_id }
  )
  return { status: 'completed' }
}
