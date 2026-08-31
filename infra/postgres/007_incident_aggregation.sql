alter table suppression_windows add column if not exists updated_at timestamptz not null default now();
alter table alerts add column if not exists signal_key text;
alter table alerts add column if not exists direction text check(direction in ('UP','DOWN','MIXED'));
alter table alerts add column if not exists min_unit_price bigint;
alter table alerts add column if not exists max_unit_price bigint;
alter table alerts add column if not exists min_deviation_pct numeric(12,4);
alter table alerts add column if not exists max_deviation_pct numeric(12,4);

create table if not exists incident_price_clusters (
  id bigserial primary key,
  alert_id bigint not null references alerts(id) on delete cascade,
  price_bucket integer not null,
  min_unit_price bigint not null,
  max_unit_price bigint not null,
  min_deviation_pct numeric(12,4),
  max_deviation_pct numeric(12,4),
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(alert_id,price_bucket)
);

drop table if exists alert_merge_map;
create temp table alert_merge_map as
select a.id old_id,
  min(a.id) over(partition by a.watch_item_id,a.signal,case when coalesce(e.price_deviation_pct,0)>=0 then 'UP' else 'DOWN' end) keeper_id,
  case when coalesce(e.price_deviation_pct,0)>=0 then 'UP' else 'DOWN' end direction
from alerts a left join anomaly_events e on e.id=a.representative_event_id;

insert into incident_price_clusters(alert_id,price_bucket,min_unit_price,max_unit_price,min_deviation_pct,max_deviation_pct,occurrences,first_seen_at,last_seen_at)
select m.keeper_id,
  floor(ln(greatest(1,s.unit_price)::numeric)/ln(1.1))::int,
  min(s.unit_price),max(s.unit_price),min(e.price_deviation_pct),max(e.price_deviation_pct),sum(a.occurrences)::int,
  min(a.first_seen_at),max(a.last_seen_at)
from alert_merge_map m join alerts a on a.id=m.old_id
join anomaly_events e on e.id=a.representative_event_id join auction_snapshots s on s.id=e.auction_snapshot_id
group by m.keeper_id,floor(ln(greatest(1,s.unit_price)::numeric)/ln(1.1))::int
on conflict(alert_id,price_bucket) do update set occurrences=incident_price_clusters.occurrences+excluded.occurrences,
  min_unit_price=least(incident_price_clusters.min_unit_price,excluded.min_unit_price),max_unit_price=greatest(incident_price_clusters.max_unit_price,excluded.max_unit_price),
  min_deviation_pct=least(incident_price_clusters.min_deviation_pct,excluded.min_deviation_pct),max_deviation_pct=greatest(incident_price_clusters.max_deviation_pct,excluded.max_deviation_pct),last_seen_at=greatest(incident_price_clusters.last_seen_at,excluded.last_seen_at);

update analysis_cases c set alert_id=m.keeper_id from alert_merge_map m where c.alert_id=m.old_id and m.old_id<>m.keeper_id;
update response_actions r set alert_id=m.keeper_id from alert_merge_map m where r.alert_id=m.old_id and m.old_id<>m.keeper_id;

with aggregated as (
  select m.keeper_id,m.direction,sum(a.occurrences)::int occurrences,max(a.risk_score) risk_score,max(a.confidence_score) confidence_score,
    min(a.first_seen_at) first_seen_at,max(a.last_seen_at) last_seen_at,
    min(s.unit_price) min_price,max(s.unit_price) max_price,min(e.price_deviation_pct) min_deviation,max(e.price_deviation_pct) max_deviation,
    (array_agg(a.representative_event_id order by a.risk_score desc,a.last_seen_at desc))[1] representative_event_id
  from alert_merge_map m join alerts a on a.id=m.old_id left join anomaly_events e on e.id=a.representative_event_id
  left join auction_snapshots s on s.id=e.auction_snapshot_id group by m.keeper_id,m.direction
)
update alerts a set fingerprint='incident-'||a.id,signal_key=lower(regexp_replace(a.signal,'[^a-zA-Z0-9가-힣]+','-','g')),
  direction=g.direction,occurrences=g.occurrences,risk_score=g.risk_score,confidence_score=g.confidence_score,
  first_seen_at=g.first_seen_at,last_seen_at=g.last_seen_at,min_unit_price=g.min_price,max_unit_price=g.max_price,
  min_deviation_pct=g.min_deviation,max_deviation_pct=g.max_deviation,representative_event_id=g.representative_event_id,updated_at=now()
from aggregated g where a.id=g.keeper_id;

delete from alerts a using alert_merge_map m where a.id=m.old_id and m.old_id<>m.keeper_id;
create index if not exists idx_alert_incident_match on alerts(watch_item_id,signal_key,direction,last_seen_at desc);
