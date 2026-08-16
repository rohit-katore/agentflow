import { gql } from '@apollo/client'

// ---------- orgs & membership ----------

export const MY_ORGS = gql`
  query MyOrgs {
    org_members(order_by: { created_at: asc }) {
      id
      role
      organization {
        id
        name
      }
    }
  }
`

export const CREATE_ORG = gql`
  mutation CreateOrg($name: String!) {
    insert_organizations_one(object: { name: $name }) {
      id
      name
    }
  }
`

export const ORG_MEMBERS = gql`
  query OrgMembers($orgId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId } }, order_by: { created_at: asc }) {
      id
      user_id
      role
      member_email
      created_at
    }
  }
`

export const ADD_MEMBER = gql`
  mutation AddMember($orgId: uuid!, $email: String!, $role: String!) {
    addOrgMember(org_id: $orgId, email: $email, role: $role) {
      member_id
      user_id
    }
  }
`

export const UPDATE_MEMBER_ROLE = gql`
  mutation UpdateMemberRole($id: uuid!, $role: String!) {
    update_org_members_by_pk(pk_columns: { id: $id }, _set: { role: $role }) {
      id
      role
    }
  }
`

export const REMOVE_MEMBER = gql`
  mutation RemoveMember($id: uuid!) {
    delete_org_members_by_pk(id: $id) {
      id
    }
  }
`

// ---------- usage / quota ----------

export const ORG_QUOTA_SUB = gql`
  subscription OrgQuota($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      id
      name
      quota_limit
      quota_used
      usage_stats {
        runs_this_month
        completed_this_month
        failed_this_month
        avg_run_seconds_this_month
      }
    }
  }
`

// ---------- workflows ----------

export const ORG_OVERVIEW = gql`
  query OrgOverview($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      is_active
      updated_at
      steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        name
      }
      triggers {
        id
        type
        is_enabled
      }
      runs(order_by: { started_at: desc_nulls_last }, limit: 1) {
        id
        status
        started_at
        finished_at
      }
    }
  }
`

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String) {
    insert_workflows_one(object: { org_id: $orgId, name: $name, description: $description }) {
      id
    }
  }
`

export const WORKFLOW_DETAIL = gql`
  query WorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      org_id
      name
      description
      is_active
      steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        name
        config
      }
      triggers(order_by: { created_at: asc }) {
        id
        type
        config
        is_enabled
        last_fired_at
      }
      runs(order_by: { started_at: desc_nulls_last }, limit: 10) {
        id
        status
        triggered_via
        error
        started_at
        finished_at
      }
    }
  }
`

export const UPDATE_WORKFLOW = gql`
  mutation UpdateWorkflow($id: uuid!, $set: workflows_set_input!) {
    update_workflows_by_pk(pk_columns: { id: $id }, _set: $set) {
      id
      name
      description
      is_active
    }
  }
`

// ---------- steps ----------

export const ADD_STEP = gql`
  mutation AddStep($object: workflow_steps_insert_input!) {
    insert_workflow_steps_one(object: $object) {
      id
    }
  }
`

export const UPDATE_STEP = gql`
  mutation UpdateStep($id: uuid!, $name: String!, $config: jsonb!) {
    update_workflow_steps_by_pk(pk_columns: { id: $id }, _set: { name: $name, config: $config }) {
      id
      name
      config
    }
  }
`

export const DELETE_STEP = gql`
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`

export const SWAP_STEPS = gql`
  mutation SwapSteps($idA: uuid!, $orderA: Int!, $idB: uuid!, $orderB: Int!) {
    a: update_workflow_steps_by_pk(pk_columns: { id: $idA }, _set: { step_order: $orderA }) {
      id
      step_order
    }
    b: update_workflow_steps_by_pk(pk_columns: { id: $idB }, _set: { step_order: $orderB }) {
      id
      step_order
    }
  }
`

// ---------- triggers ----------

export const ADD_TRIGGER = gql`
  mutation AddTrigger($object: workflow_triggers_insert_input!) {
    insert_workflow_triggers_one(object: $object) {
      id
    }
  }
`

export const UPDATE_TRIGGER = gql`
  mutation UpdateTrigger($id: uuid!, $set: workflow_triggers_set_input!) {
    update_workflow_triggers_by_pk(pk_columns: { id: $id }, _set: $set) {
      id
      config
      is_enabled
    }
  }
`

export const DELETE_TRIGGER = gql`
  mutation DeleteTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`

export const REVEAL_WEBHOOK_KEY = gql`
  mutation RevealWebhookKey($triggerId: uuid!) {
    revealWebhookKey(trigger_id: $triggerId) {
      webhook_key
      webhook_url
    }
  }
`

// ---------- runs ----------

export const TRIGGER_RUN = gql`
  mutation TriggerRun($workflowId: uuid!, $payload: jsonb) {
    triggerWorkflowRun(workflow_id: $workflowId, payload: $payload) {
      run_id
      status
    }
  }
`

export const APPROVE_STEP = gql`
  mutation Approve($stepRunId: uuid!, $decision: String!, $comment: String) {
    approveStep(step_run_id: $stepRunId, decision: $decision, comment: $comment) {
      run_id
      status
    }
  }
`

export const RECENT_RUNS_SUB = gql`
  subscription RecentRuns($orgId: uuid!) {
    workflow_runs(
      where: { org_id: { _eq: $orgId } }
      order_by: { started_at: desc_nulls_last }
      limit: 8
    ) {
      id
      status
      triggered_via
      started_at
      finished_at
      workflow {
        id
        name
      }
    }
  }
`

export const RUN_SUB = gql`
  subscription RunStatus($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      org_id
      status
      triggered_via
      trigger_payload
      error
      started_at
      finished_at
      workflow {
        id
        name
      }
    }
  }
`

export const STEP_RUNS_SUB = gql`
  subscription StepRuns($runId: uuid!) {
    step_runs(where: { run_id: { _eq: $runId } }, order_by: { step_order: asc }) {
      id
      step_order
      step_type
      step_name
      status
      input
      output
      error
      attempts
      approved_by
      approved_at
      started_at
      finished_at
    }
  }
`

// ---------- db-event demo ----------

export const INSERT_INBOUND_EVENT = gql`
  mutation InsertInboundEvent($orgId: uuid!, $source: String!, $payload: jsonb!) {
    insert_inbound_events_one(object: { org_id: $orgId, source: $source, payload: $payload }) {
      id
    }
  }
`
