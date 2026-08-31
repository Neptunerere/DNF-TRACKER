create table if not exists market_watch_items (
  id bigserial primary key,
  item_id text,
  item_name text not null unique,
  active boolean not null default true,
  priority integer not null default 50,
  collection_interval_minutes integer not null default 10,
  last_collected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists collection_runs (
  id bigserial primary key,
  watch_item_id bigint not null references market_watch_items(id),
  status text not null check (status in ('running','completed','failed')),
  listing_count integer not null default 0,
  sold_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists auction_snapshots (
  id bigserial primary key,
  collection_run_id bigint not null references collection_runs(id) on delete cascade,
  watch_item_id bigint not null references market_watch_items(id),
  auction_no bigint not null,
  item_id text not null,
  item_name text not null,
  rarity text,
  unit_price bigint not null,
  quantity integer not null,
  average_price bigint,
  registered_at timestamptz,
  captured_at timestamptz not null default now(),
  raw_payload jsonb not null
);
create index if not exists idx_auction_watch_captured on auction_snapshots(watch_item_id,captured_at desc);
create index if not exists idx_auction_price on auction_snapshots(item_id,unit_price,captured_at desc);

create table if not exists sold_snapshots (
  id bigserial primary key,
  collection_run_id bigint not null references collection_runs(id) on delete cascade,
  watch_item_id bigint not null references market_watch_items(id),
  item_id text not null,
  item_name text not null,
  unit_price bigint not null,
  quantity integer not null,
  sold_at timestamptz,
  captured_at timestamptz not null default now(),
  raw_payload jsonb not null
);
create index if not exists idx_sold_watch_captured on sold_snapshots(watch_item_id,captured_at desc);

create table if not exists anomaly_events (
  id bigserial primary key,
  auction_snapshot_id bigint not null references auction_snapshots(id) on delete cascade,
  watch_item_id bigint not null references market_watch_items(id),
  risk_score integer not null check (risk_score between 0 and 100),
  severity text not null check (severity in ('critical','high','medium','low')),
  signal text not null,
  price_deviation_pct numeric(12,4) not null,
  baseline_price numeric(20,2) not null,
  feature_payload jsonb not null,
  reviewed boolean not null default false,
  false_positive boolean,
  analyst_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_anomaly_score on anomaly_events(risk_score desc,created_at desc);

create table if not exists market_hourly_stats (
  id bigserial primary key,
  watch_item_id bigint not null references market_watch_items(id),
  bucket_at timestamptz not null,
  listing_count integer not null,
  sold_sample_count integer not null,
  median_sold_price numeric(20,2) not null,
  average_listing_price numeric(20,2) not null,
  high_risk_count integer not null,
  average_risk_score numeric(8,2) not null,
  updated_at timestamptz not null default now(),
  unique(watch_item_id,bucket_at)
);

insert into market_watch_items (item_name,priority) values
('무색 큐브 조각',100),('황금 큐브 조각',90),('흰색 큐브 조각',80),('적색 큐브 조각',80),
('청색 큐브 조각',80),('흑색 큐브 조각',80),('모순의 결정체',100),('농밀한 이계의 정수',90),
('강렬한 기운',70),('끝없는 영원',70),('골든 베릴',90),('라이언 코어',90),
('조화의 결정체',90),('왜곡된 차원의 큐브',100),('힘의 정수',80),('응축된 순수의 잔해',90),
('칼레이도 박스',70),('데이터 칩',60),('테라니움',70),('아이올라이트',80)
on conflict (item_name) do update set priority=excluded.priority;
