create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quota_limit integer not null default 50 check (quota_limit >= 0),
  quota_used integer not null default 0 check (quota_used >= 0),
  quota_period_start date not null default (date_trunc('month', now()))::date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  member_email text,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index org_members_user_id_idx on public.org_members (user_id);

-- whoever creates an organization becomes its first owner
create or replace function public.org_creator_becomes_owner()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.created_by is not null then
    insert into public.org_members (org_id, user_id, role, member_email)
    values (
      new.id,
      new.created_by,
      'owner',
      (select u.email from auth.users u where u.id = new.created_by)
    )
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger organizations_creator_owner
after insert on public.organizations
for each row execute function public.org_creator_becomes_owner();

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workflows_org_id_idx on public.workflows (org_id);

create trigger set_workflows_updated_at
before update on public.workflows
for each row execute function public.set_updated_at();

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  step_order integer not null default 0,
  type text not null check (
    type in ('llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate')
  ),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workflow_steps_workflow_id_idx on public.workflow_steps (workflow_id, step_order);

create trigger set_workflow_steps_updated_at
before update on public.workflow_steps
for each row execute function public.set_updated_at();

create table public.workflow_triggers (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  type text not null check (type in ('manual', 'webhook', 'schedule', 'db_event')),
  config jsonb not null default '{}'::jsonb,
  webhook_key text not null unique default encode(gen_random_bytes(18), 'hex'),
  is_enabled boolean not null default true,
  last_fired_at timestamptz,
  created_at timestamptz not null default now()
);

create index workflow_triggers_workflow_id_idx on public.workflow_triggers (workflow_id);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')
  ),
  triggered_via text not null default 'manual' check (
    triggered_via in ('manual', 'webhook', 'schedule', 'db_event')
  ),
  triggered_by uuid references auth.users (id) on delete set null,
  trigger_payload jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index workflow_runs_workflow_id_idx on public.workflow_runs (workflow_id, started_at desc);
create index workflow_runs_org_id_idx on public.workflow_runs (org_id, started_at desc);

create table public.step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs (id) on delete cascade,
  step_id uuid references public.workflow_steps (id) on delete set null,
  step_order integer not null,
  step_type text not null,
  step_name text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'skipped')
  ),
  input jsonb,
  output jsonb,
  error text,
  attempts integer not null default 0,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index step_runs_run_id_idx on public.step_runs (run_id, step_order);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid references public.workflow_runs (id) on delete cascade,
  step_run_id uuid references public.step_runs (id) on delete set null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index artifacts_org_id_idx on public.artifacts (org_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid references public.workflow_runs (id) on delete cascade,
  step_run_id uuid references public.step_runs (id) on delete set null,
  channel text not null default 'slack' check (channel in ('slack', 'log')),
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  detail text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_org_id_idx on public.notifications (org_id, created_at desc);

-- watched table for the db_event trigger type: inserting a row here
-- fires a Hasura event trigger that starts matching workflows
create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  source text not null default 'manual',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index inbound_events_org_id_idx on public.inbound_events (org_id, created_at desc);

-- org-level aggregation used by the frontend quota/usage indicator
create or replace view public.org_usage_stats as
select
  o.id as org_id,
  o.quota_limit,
  o.quota_used,
  o.quota_period_start,
  count(r.id) filter (where r.started_at >= date_trunc('month', now())) as runs_this_month,
  count(r.id) filter (
    where r.status = 'completed' and r.started_at >= date_trunc('month', now())
  ) as completed_this_month,
  count(r.id) filter (
    where r.status = 'failed' and r.started_at >= date_trunc('month', now())
  ) as failed_this_month,
  round(
    coalesce(
      avg(extract(epoch from r.finished_at - r.started_at)) filter (
        where r.finished_at is not null and r.started_at >= date_trunc('month', now())
      ),
      0
    )::numeric,
    2
  ) as avg_run_seconds_this_month
from public.organizations o
left join public.workflow_runs r on r.org_id = o.id
group by o.id;
