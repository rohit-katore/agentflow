# AgentFlow — design write-up

AgentFlow is a mini workflow builder in the spirit of n8n: organizations define
workflows made of ordered AI-agent steps, run them manually or from triggers,
and watch each step stream live. It runs entirely on the Nhost stack
(Postgres + Hasura + Auth + serverless functions) with a Next.js frontend.

## Architecture

All writes that need cross-cutting rules (quota, roles, mid-run approval) go
through **Hasura Actions** backed by serverless functions; everything else the
frontend does is plain GraphQL against Hasura with role-scoped permissions.
The engine (`functions/_lib/engine.ts`) executes steps in order and snapshots
each step's `type`, `name` and `config` onto its `step_runs` row, so a run
remains an accurate audit trail even if the workflow is edited later.
Execution is synchronous inside the action handler: simple, debuggable, and
long workflows are bounded by the function timeout — a queue/worker would be
the production evolution, and the engine is already isolated behind one module
boundary to make that swap.

Step types: `llm_call` (Groq, or a clearly disclosed 1.2 s stub when no
`GROQ_API_KEY` is set), `http_request`, `conditional_branch`, `approval_gate`,
`db_write` (writes an `artifacts` row), and `notify` — which inserts into a
`notifications` outbox table whose **Hasura event trigger** calls a function to
deliver (Slack webhook or log), giving at-least-once delivery. Triggers:
manual, webhook (secret key, resolved server-side), scheduled (a Hasura cron
job claims due triggers with a conditional update so concurrent firings can't
double-run), and database event (insert into `inbound_events` fires an event
trigger that starts matching workflows).

`llm_call` and `http_request` retry (2 attempts by default, linear backoff);
validation failures are marked non-retryable. Templates like
`{{trigger.lead}}`, `{{prev.text}}` and `{{steps.classify_lead.text}}` pipe
data between steps.

## Permissions — two layers

**Layer 1 — org + role scoping.** Every table's select/insert/update/delete
permission filters through the membership chain (e.g. on `workflow_runs`:
`organization.members.user_id = X-Hasura-User-Id`). Because Hasura filters
rows rather than erroring, a user in Org B who guesses an Org A run id simply
gets `null` — cross-org isolation holds even against ID guessing. Owners have
full control; editors build and run but cannot manage members (`org_members`
writes are owner-only); viewers are read-only, and run-triggering lives behind
an action that verifies owner/editor server-side, so viewers cannot trigger
even with hand-crafted GraphQL.

**Layer 2 — step-level gating.** Owner-only step types (`db_write`, `notify`)
are enforced in the `workflow_steps` insert/update check
(`_or: [{type: {_nin: [db_write, notify]}}, {workflow: {organization:
{members: {user_id..., role: {_eq: owner}}}}}]`), webhook triggers are
owner-only the same way, and `approval_gate` is checked **mid-execution**: the
run pauses (`paused` / `waiting_approval`), and the `approveStep` action
handler re-verifies the approver's role against the gate's `require_role`
before resuming or rejecting — the UI hides buttons, but the handler is the
real gate. A rejected gate cancels the run and skips remaining steps.

## Aggregation & live UX

`org_usage_stats` is a SQL view (runs, completions, failures, average run
seconds this month) tracked read-only and shown in the top bar next to the
quota meter; quota is checked before a run starts and incremented on
completion. The run page uses two GraphQL subscriptions (run + step_runs), so
pauses, retries, approvals and completions appear with no refresh.
