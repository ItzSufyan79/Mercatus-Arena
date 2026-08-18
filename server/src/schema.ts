import { query } from "./db.js";

const DDL = `
create table if not exists teams (
  team_id bigserial primary key,
  team_name text not null unique,
  role text not null default 'team' check (role in ('team','admin','evaluator')),
  email text not null unique,
  password_hash text,
  api_key text unique,
  cash_balance numeric(20,2) not null default 0,
  starting_capital numeric(20,2) not null default 0,
  total_portfolio_value numeric(20,2) not null default 0,
  is_frozen boolean not null default false,
  token_version integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists holdings (
  id bigserial primary key,
  team_id bigint not null references teams(team_id) on delete cascade,
  symbol text not null,
  quantity integer not null default 0 check (quantity >= 0),
  average_buy_price numeric(20,6) not null default 0,
  unique (team_id, symbol)
);

create table if not exists order_logs (
  order_id bigserial primary key,
  team_id bigint not null references teams(team_id) on delete cascade,
  action text not null check (action in ('BUY','SELL')),
  symbol text not null,
  quantity integer not null check (quantity > 0),
  price_requested numeric(20,6),
  price_executed numeric(20,6),
  status text not null check (status in ('SUCCESS','REJECTED')),
  reason text,
  latency_ms integer,
  client_ref text,
  timestamp_ms timestamptz not null default now()
);
create index if not exists idx_order_logs_team on order_logs(team_id, order_id desc);

create table if not exists submissions (
  submission_id bigserial primary key,
  team_id bigint not null unique references teams(team_id) on delete cascade,
  pdf_storage_url text,
  pdf_data bytea,
  pdf_name text,
  code_repository_link text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_config (
  id boolean primary key default true check (id),
  state text not null default 'PRE_LAUNCH'
    check (state in ('PRE_LAUNCH','ACTIVE_MARKET','API_FROZEN','EVENT_CONCLUDED')),
  paused boolean not null default false,
  start_capital numeric(20,2) not null default 100000,
  replay_speed numeric not null default 1,
  noise_sigma numeric not null default 0.0005,
  volatility_multiplier numeric not null default 1,
  flash_shock numeric not null default 0,
  credentials_revealed boolean not null default false,
  leaderboard_frozen boolean not null default false,
  event_started_at timestamptz,
  scheduled_end_at timestamptz,
  leaderboard_freeze_at timestamptz,
  api_freeze_at timestamptz,
  tick_count bigint not null default 0
);

create table if not exists market_datasets (
  dataset_id bigserial primary key,
  name text not null,
  row_count bigint not null default 0,
  symbol_list text[] not null default '{}',
  start_t bigint,
  end_t bigint,
  is_active boolean not null default false,
  uploaded_at timestamptz not null default now()
);

create table if not exists dataset_ticks (
  dataset_id bigint not null references market_datasets(dataset_id) on delete cascade,
  seq integer not null,
  t bigint not null,
  symbol text not null,
  price numeric(20,6) not null,
  volume integer not null default 0,
  primary key (dataset_id, seq)
);
create index if not exists idx_dataset_ticks_time on dataset_ticks(dataset_id, t);

create table if not exists market_state (
  dataset_id bigint primary key references market_datasets(dataset_id) on delete cascade,
  last_t bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists live_prices (
  symbol text primary key,
  price numeric(20,6) not null,
  prev_price numeric(20,6) not null default 0,
  last_seq integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists request_logs (
  id bigserial primary key,
  team_id bigint,
  method text,
  path text,
  status integer,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_request_logs_team on request_logs(team_id, created_at);

create table if not exists scoring (
  team_id bigint primary key references teams(team_id) on delete cascade,
  pnl_rank integer,
  code_quality_score numeric(5,2),
  strategy_report_score numeric(5,2),
  final_score numeric(6,2),
  updated_at timestamptz not null default now()
);

create table if not exists leaderboard_snapshot (
  rank integer,
  team_id bigint,
  team_name text,
  total_portfolio_value numeric(20,2),
  captured_at timestamptz not null default now()
);
create index if not exists idx_snapshot_time on leaderboard_snapshot(captured_at desc);

create table if not exists rate_limits (
  key text primary key,
  hits integer not null default 0,
  reset_at timestamptz not null default now()
);
`;

export async function migrate(): Promise<void> {
  await query(DDL);
  await query(
    `alter table teams drop constraint if exists teams_role_check;
     alter table teams add constraint teams_role_check
       check (role in ('team','admin','evaluator'));`,
  );
  await query(
    `alter table teams add column if not exists token_version integer not null default 0`,
  );
  await query(
    `insert into event_config (id) values (true)
     on conflict (id) do nothing`,
  );
}

export async function seedAdmin(): Promise<void> {
  const { config } = await import("./config.js");
  const existing = await query(
    `select team_id from teams where email = $1`,
    [config.adminEmail],
  );
  if (existing.rowCount! > 0) return;
  const { hashPassword } = await import("./auth.js");
  const passwordHash = await hashPassword(config.adminPassword);
  await query(
    `insert into teams (team_name, role, email, password_hash)
     values ('Event Admin', 'admin', $1, $2)
     on conflict (email) do nothing`,
    [config.adminEmail, passwordHash],
  );
}
