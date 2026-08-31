create table if not exists detection_rules (
  id bigserial primary key, rule_key text not null unique, name text not null, description text not null,
  version integer not null default 1, enabled boolean not null default true,
  thresholds jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);

insert into detection_rules (rule_key,name,description,thresholds) values
('price-deviation','극단 등록가','과거·최근 거래 기준선 대비 극단 가격을 탐지', '{"deviationPct":50,"robustZ":3.5}'),
('volume-price','등록량 급증 + 가격 변동','평소보다 많은 물량과 가격 변동의 동시 발생을 탐지', '{"volumeRatio":1.8,"deviationPct":15}'),
('price-cluster','동일 가격대 집중','동일 가격에 반복된 등록 물량을 탐지', '{"repeatCount":4}'),
('bulk-listing','대량 물량 등록','단일 등록의 과도한 수량을 탐지', '{"quantity":100}')
on conflict (rule_key) do nothing;

create table if not exists suppression_windows (
  id bigserial primary key, name text not null, item_pattern text,
  starts_at timestamptz not null, ends_at timestamptz not null, reason text not null,
  enabled boolean not null default true, created_at timestamptz not null default now()
);

create table if not exists alerts (
  id bigserial primary key, fingerprint text not null unique,
  watch_item_id bigint not null references market_watch_items(id),
  representative_event_id bigint references anomaly_events(id) on delete set null,
  status text not null default 'NEW' check(status in ('NEW','INVESTIGATING','BENIGN','ESCALATED','CLOSED')),
  severity text not null check(severity in ('critical','high','medium','low')),
  risk_score integer not null, confidence_score integer not null,
  signal text not null, occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  assigned_to text, resolution_reason text, analyst_note text,
  suppressed boolean not null default false,
  suppression_window_id bigint references suppression_windows(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_alert_queue on alerts(status,severity,risk_score desc,last_seen_at desc);

create table if not exists analysis_cases (
  id bigserial primary key, alert_id bigint not null references alerts(id) on delete cascade,
  title text not null, status text not null default 'OPEN' check(status in ('OPEN','IN_PROGRESS','RESOLVED')),
  priority text not null default 'P2' check(priority in ('P1','P2','P3')),
  owner text, summary text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists backtest_runs (
  id bigserial primary key, rule_key text not null, parameters jsonb not null,
  result jsonb not null, created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id bigserial primary key, entity_type text not null, entity_id bigint,
  action text not null, actor text not null default 'portfolio-analyst', before_payload jsonb,
  after_payload jsonb, created_at timestamptz not null default now()
);
