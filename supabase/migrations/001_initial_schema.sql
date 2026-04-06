-- Searches: every search ever run, tied to the authenticated user
create table searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  procedure     text not null,
  geography     text,
  result_count  int not null default 0,
  results_json  jsonb not null default '[]'::jsonb,

  -- analytics
  discovery_searches   int,
  vetting_searches     int,
  candidates_dropped   int,
  duration_total_ms    int,
  duration_discovery_ms int,
  duration_vetting_ms  int,
  duration_scoring_ms  int,
  tokens_in            int,
  tokens_out           int,
  cost_usd             numeric(10,4),
  error_type           text,

  created_at   timestamptz not null default now()
);

create index idx_searches_user_id on searches(user_id);
create index idx_searches_created_at on searches(created_at desc);

-- Unlocks: tracks which searches a user has paid to fully reveal
create table unlocks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  search_id         uuid not null references searches(id) on delete cascade,
  stripe_session_id text not null,
  amount_usd        numeric(10,2) not null,
  created_at        timestamptz not null default now(),

  unique(user_id, search_id)
);

create index idx_unlocks_user_id on unlocks(user_id);
create index idx_unlocks_search_id on unlocks(search_id);

-- Row Level Security
alter table searches enable row level security;
alter table unlocks enable row level security;

-- Users can only see their own searches
create policy "Users can view own searches"
  on searches for select
  using (auth.uid() = user_id);

create policy "Users can insert own searches"
  on searches for insert
  with check (auth.uid() = user_id);

-- Users can only see their own unlocks
create policy "Users can view own unlocks"
  on unlocks for select
  using (auth.uid() = user_id);

-- Only the service role (webhooks) can insert unlocks
create policy "Service role can insert unlocks"
  on unlocks for insert
  with check (true);
