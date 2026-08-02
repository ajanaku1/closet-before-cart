begin;

create table if not exists style_cases (
  id uuid primary key,
  sender_ref text not null,
  state text not null check (state in (
    'RECEIVED',
    'EXTRACTING',
    'WARDROBE_READY',
    'RENDERING',
    'MORE_EVIDENCE',
    'STYLE_READY',
    'GAP_FOUND',
    'QUOTING',
    'AWAITING_APPROVAL',
    'PAYMENT_PROCESSING',
    'SANDBOX_COMPLETED',
    'ORDER_COMPLETED',
    'FAILED'
  )),
  constraint_version integer not null default 1 check (constraint_version > 0),
  constraints jsonb not null,
  result jsonb,
  retention_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists garment_items (
  id text primary key,
  case_id uuid not null references style_cases(id) on delete cascade,
  source_attachment_id text not null,
  category text not null check (category in ('TOP', 'BOTTOM', 'SHOES')),
  color text not null,
  pattern text not null check (pattern in ('SOLID', 'STRIPED', 'CHECK', 'PRINT', 'UNKNOWN')),
  formality text not null check (formality in ('CASUAL', 'SMART', 'FORMAL')),
  weather_suitability text not null check (weather_suitability in ('WARM', 'MILD', 'COLD', 'ALL')),
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  digest text not null unique check (digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (case_id, source_attachment_id, id)
);

create table if not exists commerce_quotes (
  id uuid primary key,
  case_id uuid not null references style_cases(id) on delete cascade,
  merchant text not null,
  variant_id text not null,
  size text,
  color text,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  available boolean not null,
  source_mode text not null check (source_mode in ('LIVE', 'PINNED_DEMO')),
  checkout_reference text,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists style_proofs (
  id uuid primary key,
  case_id uuid not null references style_cases(id) on delete cascade,
  garment_digest text not null check (length(garment_digest) > 0),
  constraint_digest text not null check (length(constraint_digest) > 0),
  rule_version text not null,
  decision text not null check (decision in ('MORE_EVIDENCE', 'STYLE_READY', 'GAP_FOUND')),
  missing_category text check (missing_category in ('TOP', 'BOTTOM', 'SHOES')),
  quote_id uuid references commerce_quotes(id),
  merchant text,
  variant_id text,
  amount_minor bigint check (amount_minor > 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  signature text not null unique,
  created_at timestamptz not null default now(),
  check (
    (quote_id is null and merchant is null and variant_id is null and amount_minor is null and currency is null)
    or
    (quote_id is not null and merchant is not null and variant_id is not null and amount_minor is not null and currency is not null)
  )
);

create table if not exists payment_attempts (
  id uuid primary key,
  case_id uuid not null references style_cases(id) on delete cascade,
  proof_id uuid not null references style_proofs(id),
  idempotency_key text not null unique,
  prava_reference text,
  merchant text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  mode text not null check (mode in ('SANDBOX', 'PRODUCTION')),
  status text not null check (status in ('PENDING', 'APPROVED', 'DECLINED', 'FAILED')),
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists processed_webhooks (
  source text not null check (source in ('LINQ', 'PRAVA')),
  external_id text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  safe_result_code text not null,
  processed_at timestamptz not null default now(),
  primary key (source, external_id)
);

create table if not exists audit_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references style_cases(id) on delete cascade,
  prior_state text,
  new_state text,
  actor_source text not null,
  event_type text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (actor_source, idempotency_key)
);

create index if not exists style_cases_state_idx
  on style_cases (state, updated_at);
create index if not exists commerce_quotes_case_retrieved_idx
  on commerce_quotes (case_id, retrieved_at desc);
create index if not exists style_proofs_expires_idx
  on style_proofs (expires_at);
create index if not exists payment_attempts_status_idx
  on payment_attempts (status, updated_at);
create index if not exists audit_events_case_occurred_idx
  on audit_events (case_id, occurred_at, id);

create or replace function reject_immutable_row_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end;
$$;

drop trigger if exists prevent_commerce_quote_update on commerce_quotes;
create trigger prevent_commerce_quote_update
before update on commerce_quotes
for each row execute function reject_immutable_row_change();

drop trigger if exists prevent_audit_event_update on audit_events;
create trigger prevent_audit_event_update
before update on audit_events
for each row execute function reject_immutable_row_change();

drop trigger if exists prevent_audit_event_delete on audit_events;
create trigger prevent_audit_event_delete
before delete on audit_events
for each row execute function reject_immutable_row_change();

commit;
