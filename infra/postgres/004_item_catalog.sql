create extension if not exists pg_trgm;

create table if not exists item_catalog (
  id bigserial primary key,
  item_name text not null,
  item_kind text not null,
  category text not null default '',
  level integer,
  job_name text,
  source_name text not null,
  source_url text,
  market_verified boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_name,item_name,category)
);

create index if not exists item_catalog_name_idx on item_catalog using gin (item_name gin_trgm_ops);
create index if not exists item_catalog_kind_idx on item_catalog (item_kind,category);
