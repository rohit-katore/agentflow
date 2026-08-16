#!/usr/bin/env node
/**
 * Seed script for AgentFlow.
 *
 * Creates:
 *   - Org A "Acme Research": alice (owner), bob (editor), cara (viewer)
 *   - Org B "Beta Industries": dan (owner)
 *   - "Lead qualifier" workflow in Org A with six steps
 *     (llm_call -> conditional_branch -> http_request -> approval_gate -> db_write -> notify)
 *     plus webhook and db_event triggers
 *   - "Daily digest" workflow in Org B with a schedule trigger
 *
 * Local usage:
 *   nhost up
 *   node scripts/seed.mjs
 *
 * Against Nhost Cloud:
 *   GRAPHQL_URL=https://<sub>.graphql.<region>.nhost.run/v1 \
 *   AUTH_URL=https://<sub>.auth.<region>.nhost.run/v1 \
 *   FUNCTIONS_URL=https://<sub>.functions.<region>.nhost.run/v1 \
 *   ADMIN_SECRET=<hasura admin secret> node scripts/seed.mjs
 *
 * Note: user signups need "require email verification" to be OFF while seeding
 * (it is off by default locally).
 */

const GRAPHQL_URL = process.env.GRAPHQL_URL ?? 'https://local.graphql.local.nhost.run/v1'
const AUTH_URL = process.env.AUTH_URL ?? 'https://local.auth.local.nhost.run/v1'
const FUNCTIONS_URL = process.env.FUNCTIONS_URL ?? 'https://local.functions.local.nhost.run/v1'
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'nhost-admin-secret'

const PASSWORD = 'AgentFlow#2026'

async function adminGql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) {
    throw new Error('GraphQL error: ' + JSON.stringify(json.errors, null, 2))
  }
  return json.data
}

async function tryAuth(path, body) {
  const res = await fetch(AUTH_URL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  return json && json.session ? json.session : null
}

// Sign in if the account exists, otherwise sign up. Returns the user id
// without needing any Hasura tracking of the auth schema.
async function ensureUser(email) {
  let session = await tryAuth('/signin/email-password', { email, password: PASSWORD })
  if (!session) {
    session = await tryAuth('/signup/email-password', { email, password: PASSWORD })
  }
  if (!session) {
    session = await tryAuth('/signin/email-password', { email, password: PASSWORD })
  }
  if (!session || !session.user) {
    throw new Error(
      'Could not create or sign in ' +
        email +
        '. Check AUTH_URL and make sure email verification is not required.'
    )
  }
  console.log('user ok       ' + email + ' (' + session.user.id + ')')
  return session.user.id
}

// The organizations_creator_owner DB trigger adds the creator as owner.
async function ensureOrg(name, creatorId) {
  const existing = await adminGql(
    'query($name: String!) { organizations(where: {name: {_eq: $name}}, limit: 1) { id } }',
    { name }
  )
  if (existing.organizations[0]) {
    console.log('org exists    ' + name)
    return existing.organizations[0].id
  }
  const data = await adminGql(
    'mutation($object: organizations_insert_input!) { insert_organizations_one(object: $object) { id } }',
    { object: { name, created_by: creatorId } }
  )
  console.log('org created   ' + name)
  return data.insert_organizations_one.id
}

async function ensureMember(orgId, userId, role, email) {
  await adminGql(
    'mutation($object: org_members_insert_input!) {\n' +
      '  insert_org_members_one(\n' +
      '    object: $object\n' +
      '    on_conflict: {constraint: org_members_org_id_user_id_key, update_columns: [role]}\n' +
      '  ) { id }\n' +
      '}',
    { object: { org_id: orgId, user_id: userId, role, member_email: email } }
  )
  console.log('member ok     ' + email + ' -> ' + role)
}

async function ensureWorkflow(orgId, createdBy, name, description) {
  const existing = await adminGql(
    'query($orgId: uuid!, $name: String!) { workflows(where: {org_id: {_eq: $orgId}, name: {_eq: $name}}, limit: 1) { id } }',
    { orgId, name }
  )
  if (existing.workflows[0]) {
    console.log('workflow exists ' + name)
    return { id: existing.workflows[0].id, fresh: false }
  }
  const data = await adminGql(
    'mutation($object: workflows_insert_input!) { insert_workflows_one(object: $object) { id } }',
    { object: { org_id: orgId, created_by: createdBy, name, description } }
  )
  console.log('workflow created ' + name)
  return { id: data.insert_workflows_one.id, fresh: true }
}

async function addSteps(workflowId, steps) {
  await adminGql(
    'mutation($objects: [workflow_steps_insert_input!]!) { insert_workflow_steps(objects: $objects) { affected_rows } }',
    {
      objects: steps.map((s, i) => ({
        workflow_id: workflowId,
        step_order: i + 1,
        type: s.type,
        name: s.name,
        config: s.config,
      })),
    }
  )
  console.log('steps added   ' + steps.length)
}

async function ensureTrigger(workflowId, type, config) {
  const existing = await adminGql(
    'query($workflowId: uuid!, $type: String!) { workflow_triggers(where: {workflow_id: {_eq: $workflowId}, type: {_eq: $type}}, limit: 1) { id } }',
    { workflowId, type }
  )
  if (existing.workflow_triggers[0]) return existing.workflow_triggers[0].id
  const data = await adminGql(
    'mutation($object: workflow_triggers_insert_input!) { insert_workflow_triggers_one(object: $object) { id } }',
    { object: { workflow_id: workflowId, type, config } }
  )
  console.log('trigger added ' + type)
  return data.insert_workflow_triggers_one.id
}

async function main() {
  console.log('Seeding AgentFlow against ' + GRAPHQL_URL)

  const alice = await ensureUser('alice@orga.dev')
  const bob = await ensureUser('bob@orga.dev')
  const cara = await ensureUser('cara@orga.dev')
  const dan = await ensureUser('dan@orgb.dev')

  const orgA = await ensureOrg('Acme Research', alice)
  const orgB = await ensureOrg('Beta Industries', dan)

  await ensureMember(orgA, alice, 'owner', 'alice@orga.dev')
  await ensureMember(orgA, bob, 'editor', 'bob@orga.dev')
  await ensureMember(orgA, cara, 'viewer', 'cara@orga.dev')
  await ensureMember(orgB, dan, 'owner', 'dan@orgb.dev')

  const lead = await ensureWorkflow(
    orgA,
    alice,
    'Lead qualifier',
    'Classifies inbound leads with an LLM, enriches qualified ones, waits for human sign-off, then stores the assessment.'
  )
  if (lead.fresh) {
    await addSteps(lead.id, [
      {
        type: 'llm_call',
        name: 'Classify lead',
        config: {
          prompt:
            'Decide whether this sales lead is worth pursuing. Reply with exactly one word first - APPROVE or REJECT - then a one-sentence reason.\n\nLead: {{trigger.lead}}',
          model: 'llama-3.1-8b-instant',
        },
      },
      {
        type: 'conditional_branch',
        name: 'Only qualified leads',
        config: {
          input: '{{steps.classify_lead.text}}',
          operator: 'starts_with',
          value: 'APPROVE',
          if_false: 'end_run',
        },
      },
      {
        type: 'http_request',
        name: 'Enrich via httpbin',
        config: {
          url: 'https://httpbin.org/post',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: { lead: '{{trigger.lead}}', assessment: '{{steps.classify_lead.text}}' },
        },
      },
      {
        type: 'approval_gate',
        name: 'Human sign-off',
        config: {
          note: 'Confirm this lead should be stored in the CRM.',
          require_role: 'editor',
        },
      },
      {
        type: 'db_write',
        name: 'Store assessment',
        config: {
          key: 'lead_assessment',
          value: { lead: '{{trigger.lead}}', assessment: '{{steps.classify_lead.text}}' },
        },
      },
      {
        type: 'notify',
        name: 'Announce result',
        config: {
          channel: 'log',
          message: 'Lead stored: {{trigger.lead}} -> {{steps.classify_lead.text}}',
        },
      },
    ])
  }
  const webhookTrigger = await ensureTrigger(lead.id, 'webhook', {})
  await ensureTrigger(lead.id, 'db_event', {})

  const digest = await ensureWorkflow(
    orgB,
    dan,
    'Daily digest',
    'Writes a short morning status digest.'
  )
  if (digest.fresh) {
    await addSteps(digest.id, [
      {
        type: 'llm_call',
        name: 'Write digest',
        config: { prompt: 'Write a two-sentence upbeat status digest for Beta Industries.' },
      },
      { type: 'notify', name: 'Log digest', config: { channel: 'log', message: '{{prev.text}}' } },
    ])
  }
  await ensureTrigger(digest.id, 'schedule', { cron: '0 9 * * *' })

  const keyData = await adminGql(
    'query($id: uuid!) { workflow_triggers_by_pk(id: $id) { webhook_key } }',
    { id: webhookTrigger }
  )
  const webhookKey = keyData.workflow_triggers_by_pk?.webhook_key

  console.log('\nDone. Demo accounts (password ' + PASSWORD + '):')
  console.log('  alice@orga.dev  owner  of Acme Research')
  console.log('  bob@orga.dev    editor of Acme Research')
  console.log('  cara@orga.dev   viewer of Acme Research')
  console.log('  dan@orgb.dev    owner  of Beta Industries')
  if (webhookKey) {
    console.log('\nWebhook test for "Lead qualifier":')
    console.log(
      "  curl -X POST '" +
        FUNCTIONS_URL +
        '/workflows/webhook?key=' +
        webhookKey +
        "' \\\n    -H 'content-type: application/json' \\\n    -d '{\"lead\": \"Jane from Initech wants 500 seats for the fall rollout\"}'"
    )
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
