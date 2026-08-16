# AgentFlow

A mini AI-agent workflow builder (think tiny n8n) on the Nhost stack:
organizations own workflows made of ordered steps — LLM calls, HTTP requests,
conditional branches, approval gates, DB writes, notifications — executed with
retries, quotas, live-streaming statuses, and org/role-scoped permissions.

Stack: **Nhost** (Postgres + Hasura + Auth + Functions) · **GraphQL**
(queries, mutations, subscriptions) · **Next.js / React** · **Groq** for real
LLM calls (with a disclosed stub fallback).

See `docs/WRITEUP.md` for the design write-up.

## Repo layout

```
nhost/            nhost.toml, migrations (schema), metadata (tracking, permissions, actions,
                  event triggers, cron)
functions/        Hasura action handlers, event-trigger hooks, cron scheduler, workflow engine
web/              Next.js app (auth, org context, builder, live run view, members)
scripts/seed.mjs  demo data: 2 orgs, 4 users, workflows with all step types
docs/WRITEUP.md   ~1 page architecture & permissions write-up
```

## Run locally

Prereqs: [Nhost CLI](https://docs.nhost.io/development/cli/overview), Node 18+.

```bash
nhost up                      # starts Postgres, Hasura, Auth, Functions; applies
                              # migrations + metadata
node scripts/seed.mjs         # seeds demo users, orgs, workflows (prints creds + webhook curl)

cd web
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Optional secrets (in `.secrets` locally, or Nhost dashboard in the cloud):

| Secret | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Real LLM calls via Groq (`llama-3.1-8b-instant`, free tier). **Without it, `llm_call` uses a stub: ~1.2 s artificial delay, reply starts `APPROVE - stubbed LLM output`, and the step output is marked `stubbed: true`.** |
| `SLACK_WEBHOOK_URL` | Real delivery for `notify` steps on the `slack` channel (otherwise they log). |

## Deploy

1. **Backend — Nhost Cloud:** create an app, connect this GitHub repo; Nhost
   applies `nhost/` migrations + metadata and deploys `functions/` on push.
   Add the secrets above in *Settings → Secrets* (optional).
2. **Frontend — Vercel:** import the repo with root directory `web`, and set
   `NEXT_PUBLIC_NHOST_SUBDOMAIN` and `NEXT_PUBLIC_NHOST_REGION` to your Nhost
   app's values. (`nhost/nhost.toml` already allows `https://*.vercel.app`
   redirect URLs; add your exact domain in the Nhost auth settings if you
   prefer.)
3. **Seed the cloud app** (turn OFF “require email verification” first, or
   verify the four users by hand):

```bash
GRAPHQL_URL=https://<sub>.graphql.<region>.nhost.run/v1 \
AUTH_URL=https://<sub>.auth.<region>.nhost.run/v1 \
FUNCTIONS_URL=https://<sub>.functions.<region>.nhost.run/v1 \
ADMIN_SECRET=<hasura admin secret> node scripts/seed.mjs
```

## Seeded demo data

Password for all: `AgentFlow#2026`

| User | Org | Role |
| --- | --- | --- |
| alice@orga.dev | Acme Research | owner |
| bob@orga.dev | Acme Research | editor |
| cara@orga.dev | Acme Research | viewer |
| dan@orgb.dev | Beta Industries | owner |

**Lead qualifier** (Acme Research): `llm_call` (classify APPROVE/REJECT) →
`conditional_branch` (continue only on APPROVE) → `http_request`
(POST httpbin.org) → `approval_gate` (owner/editor sign-off) → `db_write`
(store artifact) → `notify`. Triggers: webhook + database event.
**Daily digest** (Beta Industries): `llm_call` → `notify`, on a `0 9 * * *`
schedule.

## Demo script (final task)

1. Sign in as **alice** → open *Lead qualifier* → **Run now** with the default
   payload. Watch steps stream live: classify → branch → HTTP → pause at
   **Human sign-off** (`paused` / awaiting approval).
2. Approve it (as alice, or sign in as **bob** — editors may clear this gate).
   The run resumes and completes; quota ticks up in the top bar.
3. Run it again and **Reject** — the run is cancelled and remaining steps are
   skipped.
4. Sign in as **cara** (viewer): no Run button, approval panel is read-only,
   builder edits are hidden.
5. Webhook + event: paste the seed script's `curl` (or *Reveal webhook URL* as
   alice) to start a run with no UI; or press **Simulate DB event** to start it
   via the `inbound_events` event trigger. Both appear live on the dashboard.
6. Isolation: sign in as **dan** — Acme's workflows/runs are invisible; opening
   a copied Acme run/workflow URL shows nothing (row-level filters return
   empty, even with guessed IDs), and hand-crafted GraphQL can't read, trigger,
   or approve them.

## Permissions at a glance

| Capability | owner | editor | viewer |
| --- | --- | --- | --- |
| See org data (workflows, runs, members) | ✓ | ✓ | ✓ |
| Create/edit workflows, steps, triggers | ✓ | ✓ | – |
| Trigger runs / simulate events | ✓ | ✓ | – |
| Approve `approval_gate` steps | ✓ | ✓ (unless gate requires owner) | – |
| Add `db_write` / `notify` steps | ✓ | – | – |
| Create/delete webhook triggers, reveal URL | ✓ | – (can reveal) | – |
| Manage members & roles | ✓ | – | – |

Layer 1 (org scoping via `org_members`) and Layer 2 (step-type and approval
gating) are both visible in `nhost/metadata/databases/default/tables/*.yaml`
and in the action handlers under `functions/workflows/`.
