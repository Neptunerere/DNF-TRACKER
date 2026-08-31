create table if not exists operational_contexts (
  id bigserial primary key,
  context_type text not null check (context_type in ('UPDATE','EVENT','MAINTENANCE','PACKAGE','CONTENT_RESET','OTHER')),
  title text not null,
  description text,
  item_pattern text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source_label text,
  status text not null default 'PLANNED' check (status in ('PLANNED','ACTIVE','ENDED','CANCELLED')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists collaboration_notes (
  id bigserial primary key,
  context_id bigint references operational_contexts(id) on delete cascade,
  alert_id bigint references alerts(id) on delete cascade,
  author_role text not null default 'CM' check (author_role in ('CM','SECURITY','OPERATIONS')),
  feedback_type text not null default 'CONTEXT' check (feedback_type in ('CONTEXT','CONFIRMED_EVENT','NEEDS_REVIEW','POLICY_NOTE','COMMUNICATION')),
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists response_actions (
  id bigserial primary key,
  alert_id bigint references alerts(id) on delete cascade,
  case_id bigint references analysis_cases(id) on delete set null,
  action_type text not null check (action_type in ('MONITOR','REQUEST_CM_CONTEXT','REQUEST_DEEP_ANALYSIS','RULE_IMPROVEMENT','WATCHLIST_PRIORITY','CLOSE_NORMAL')),
  target_team text,
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  owner text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operational_contexts_period_idx on operational_contexts(starts_at,ends_at);
create index if not exists collaboration_notes_alert_idx on collaboration_notes(alert_id,created_at desc);
create index if not exists response_actions_status_idx on response_actions(status,created_at desc);
