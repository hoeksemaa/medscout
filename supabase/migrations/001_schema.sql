-- 002_revised_schema.sql
-- Replaces the initial schema with revised searches, unlocks, and profiles tables.

-- Drop old tables (unlocks references searches, so drop first)
drop table if exists unlocks;
drop table if exists searches;

-- Profiles: app-level user data, linked to auth.users
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id  text,
  created_at          timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

-- Searches: append-only record of every search run
create table searches (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,

  -- what was requested
  procedure              text not null,
  geography              text,
  requested_count        int not null default 20,

  -- what came back
  status                 text not null default 'running'
                         check (status in ('running', 'completed', 'failed')),
  result_count           int not null default 0,
  results_json           jsonb not null default '[]'::jsonb,
  error_message          text,

  -- which providers were used
  search_engine          text not null,
  llm_model              text not null,

  -- usage counts
  search_count_discovery int,
  search_count_vetting   int,
  tokens_in              int,
  tokens_out             int,

  -- timing (seconds)
  started_at             timestamptz not null default now(),
  duration_total_s       numeric,
  duration_discovery_s   numeric,
  duration_vetting_s     numeric,
  duration_scoring_s     numeric,

  -- audit trail: array of { phase, event_type, timestamp, data }
  audit_log              jsonb not null default '[]'::jsonb
);

create index idx_searches_user_id on searches(user_id);
create index idx_searches_started_at on searches(started_at desc);

alter table searches enable row level security;

create policy "Users can view own searches"
  on searches for select using (auth.uid() = user_id);

create policy "Users can insert own searches"
  on searches for insert with check (auth.uid() = user_id);

-- Unlocks: mutable record of paid access to a search
create table unlocks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  search_id         uuid not null references searches(id) on delete cascade,
  stripe_session_id text not null,
  amount_usd        numeric(10,2) not null,
  unlocked_at       timestamptz not null default now(),

  unique(user_id, search_id)
);

create index idx_unlocks_user_id on unlocks(user_id);
create index idx_unlocks_search_id on unlocks(search_id);

alter table unlocks enable row level security;

create policy "Users can view own unlocks"
  on unlocks for select using (auth.uid() = user_id);

create policy "Service role can insert unlocks"
  on unlocks for insert with check (true);
