-- Product-suite tables. Run once in the Supabase SQL editor.
-- The backend uses the service-role key (bypasses RLS), but RLS is enabled
-- anyway so anon/authenticated Postgrest access stays locked down.

-- F3: forecast accountability log (one snapshot per symbol per day)
create table if not exists public.forecast_log (
  id uuid default gen_random_uuid() primary key,
  symbol text not null,
  snapshot_date date not null,
  last_close numeric not null,
  forecast_model text not null,
  horizon integer not null,
  base numeric not null,
  lower numeric,
  upper numeric,
  conviction_score numeric,
  conviction_label text,
  prob_up numeric,
  created_at timestamptz default timezone('utc', now()),
  unique (symbol, snapshot_date)
);
alter table public.forecast_log enable row level security;

-- F4: alert rules + triggered events
create table if not exists public.alerts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  rule_type text not null check (rule_type in ('price_above', 'price_below', 'rsi_overbought', 'rsi_oversold', 'conviction_flip')),
  threshold numeric,
  active boolean default true,
  last_state text,
  last_triggered_at timestamptz,
  created_at timestamptz default timezone('utc', now())
);
create index if not exists alerts_user_idx on public.alerts (user_id);
create index if not exists alerts_active_idx on public.alerts (active) where active;
alter table public.alerts enable row level security;

create table if not exists public.alert_events (
  id uuid default gen_random_uuid() primary key,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  rule_type text not null,
  message text not null,
  seen boolean default false,
  triggered_at timestamptz default timezone('utc', now())
);
create index if not exists alert_events_user_idx on public.alert_events (user_id, seen);
alter table public.alert_events enable row level security;

-- F7: Alpaca broker connections (paper trading credentials per user)
create table if not exists public.broker_connections (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null default 'alpaca',
  key_id text not null,
  secret_key text not null,
  is_paper boolean not null default true,
  created_at timestamptz default timezone('utc', now()),
  unique (user_id, broker)
);
create index if not exists broker_connections_user_idx on public.broker_connections (user_id);
alter table public.broker_connections enable row level security;

-- F6: portfolio positions
create table if not exists public.positions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  shares numeric not null check (shares > 0),
  cost_basis numeric not null check (cost_basis > 0),
  opened_at date default current_date,
  created_at timestamptz default timezone('utc', now())
);
create index if not exists positions_user_idx on public.positions (user_id);
alter table public.positions enable row level security;
