create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table public.schedule_state (
  singleton boolean primary key default true check (singleton),
  document_meta jsonb not null default '{}'::jsonb,
  calendar2_meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.schedule_calendars (
  id bigint generated always as identity primary key,
  calendar_key text not null unique,
  month smallint check (month between 0 and 11),
  year smallint check (year between 2000 and 2200),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schedule_days (
  calendar_id bigint not null references public.schedule_calendars(id) on delete cascade,
  day smallint not null check (day between 1 and 31),
  day_of_week text,
  headcount smallint check (headcount is null or headcount >= 0),
  manual_division boolean not null default false,
  working_people jsonb not null default '[]'::jsonb,
  absent_people jsonb not null default '[]'::jsonb,
  division jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  primary key (calendar_id, day)
);

create table public.schedule_changes (
  calendar_id bigint not null references public.schedule_calendars(id) on delete cascade,
  change_id text not null,
  position smallint not null check (position > 0),
  change_type text,
  status text,
  day_a smallint,
  day_b smallint,
  person_a text,
  person_b text,
  payload jsonb not null,
  primary key (calendar_id, position)
);

create table public.operational_messages (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('cop_rede_informa', 'cop_rede_empresarial')),
  message_id text not null,
  record_id text,
  event_at timestamptz,
  received_at timestamptz,
  area_panel text,
  original_group text,
  responsible text,
  message_type text,
  volume integer check (volume is null or volume >= 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, message_id)
);

create table public.operational_alerts (
  id bigint generated always as identity primary key,
  alert_id text not null unique,
  message_id text,
  event_at timestamptz,
  received_at timestamptz,
  area_panel text,
  original_group text,
  status text not null default 'novo' check (status in ('novo', 'em_analise', 'tratado')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hub_allocations (
  id bigint generated always as identity primary key,
  message_id text not null unique,
  record_id text,
  allocation_type text check (allocation_type in ('DIURNO', 'MADRUGADA')),
  allocation_date date,
  received_at timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.data_migration_runs (
  id bigint generated always as identity primary key,
  source text not null,
  snapshot_sha256 text not null,
  schedule_count integer not null default 0 check (schedule_count >= 0),
  message_count integer not null default 0 check (message_count >= 0),
  alert_count integer not null default 0 check (alert_count >= 0),
  hub_allocation_count integer not null default 0 check (hub_allocation_count >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, snapshot_sha256)
);

create index operational_messages_channel_event_at_idx
  on public.operational_messages (channel, event_at desc);
create index operational_messages_area_event_at_idx
  on public.operational_messages (area_panel, event_at desc)
  where area_panel is not null;
create index operational_alerts_status_event_at_idx
  on public.operational_alerts (status, event_at desc);
create index operational_alerts_open_event_at_idx
  on public.operational_alerts (event_at desc)
  where status <> 'tratado';
create index hub_allocations_type_received_at_idx
  on public.hub_allocations (allocation_type, received_at desc);
create index schedule_changes_calendar_change_id_idx
  on public.schedule_changes (calendar_id, change_id);

alter table public.schedule_state enable row level security;
alter table public.schedule_calendars enable row level security;
alter table public.schedule_days enable row level security;
alter table public.schedule_changes enable row level security;
alter table public.operational_messages enable row level security;
alter table public.operational_alerts enable row level security;
alter table public.hub_allocations enable row level security;
alter table public.data_migration_runs enable row level security;

revoke all on table
  public.schedule_state,
  public.schedule_calendars,
  public.schedule_days,
  public.schedule_changes,
  public.operational_messages,
  public.operational_alerts,
  public.hub_allocations,
  public.data_migration_runs
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.schedule_state,
  public.schedule_calendars,
  public.schedule_days,
  public.schedule_changes,
  public.operational_messages,
  public.operational_alerts,
  public.hub_allocations,
  public.data_migration_runs
to service_role;

grant usage on schema public to service_role;
grant usage, select on sequence
  public.schedule_calendars_id_seq,
  public.operational_messages_id_seq,
  public.operational_alerts_id_seq,
  public.hub_allocations_id_seq,
  public.data_migration_runs_id_seq
to service_role;

create or replace function app_private.insert_schedule_calendar(
  p_calendar_key text,
  p_calendar jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_calendar_id bigint;
begin
  if p_calendar is null
     or p_calendar = 'null'::jsonb
     or jsonb_typeof(p_calendar) <> 'object' then
    return;
  end if;

  insert into public.schedule_calendars (
    calendar_key,
    month,
    year,
    metadata
  ) values (
    p_calendar_key,
    case
      when coalesce(p_calendar ->> 'mes', '') ~ '^[0-9]+$'
        then (p_calendar ->> 'mes')::smallint
      else null
    end,
    case
      when coalesce(p_calendar ->> 'ano', '') ~ '^[0-9]+$'
        then (p_calendar ->> 'ano')::smallint
      else null
    end,
    p_calendar
      - 'dadosOriginais'
      - 'trocas'
  )
  returning id into v_calendar_id;

  insert into public.schedule_days (
    calendar_id,
    day,
    day_of_week,
    headcount,
    manual_division,
    working_people,
    absent_people,
    division,
    payload
  )
  select
    v_calendar_id,
    case
      when item.key ~ '^[0-9]{1,2}$' then item.key::smallint
      else null
    end,
    nullif(item.value ->> 'diaSemana', ''),
    case
      when coalesce(item.value ->> 'numPessoas', '') ~ '^[0-9]+$'
        then (item.value ->> 'numPessoas')::smallint
      else null
    end,
    case lower(coalesce(item.value ->> 'divisaoManual', 'false'))
      when 'true' then true
      when '1' then true
      when 'yes' then true
      else false
    end,
    case
      when jsonb_typeof(item.value -> 'trabalhando') = 'array'
        then item.value -> 'trabalhando'
      else '[]'::jsonb
    end,
    case
      when jsonb_typeof(item.value -> 'ausentes') = 'array'
        then item.value -> 'ausentes'
      else '[]'::jsonb
    end,
    case
      when jsonb_typeof(item.value -> 'divisao') = 'object'
        then item.value -> 'divisao'
      else '{}'::jsonb
    end,
    item.value
  from jsonb_each(
    case
      when jsonb_typeof(p_calendar -> 'dadosOriginais') = 'object'
        then p_calendar -> 'dadosOriginais'
      else '{}'::jsonb
    end
  ) as item
  where case
    when item.key ~ '^[0-9]{1,2}$' then item.key::integer
    else null
  end between 1 and 31;

  insert into public.schedule_changes (
    calendar_id,
    change_id,
    position,
    change_type,
    status,
    day_a,
    day_b,
    person_a,
    person_b,
    payload
  )
  select
    v_calendar_id,
    coalesce(
      nullif(item.value ->> 'id', ''),
      nullif(item.value ->> 'troca_id', ''),
      'position-' || item.ordinality::text
    ),
    item.ordinality::smallint,
    coalesce(nullif(item.value ->> 'tipo', ''), nullif(item.value ->> 'type', '')),
    nullif(item.value ->> 'status', ''),
    case
      when coalesce(item.value ->> 'dia_a', '') ~ '^[0-9]{1,2}$'
        then (item.value ->> 'dia_a')::smallint
      else null
    end,
    case
      when coalesce(item.value ->> 'dia_b', '') ~ '^[0-9]{1,2}$'
        then (item.value ->> 'dia_b')::smallint
      else null
    end,
    nullif(item.value ->> 'pessoa_a', ''),
    nullif(item.value ->> 'pessoa_b', ''),
    item.value
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_calendar -> 'trocas') = 'array'
        then p_calendar -> 'trocas'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality);
end;
$$;

create or replace function app_private.build_schedule_calendar(p_calendar_key text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select
    calendar.metadata
    || jsonb_build_object(
      'dadosOriginais', coalesce((
        select jsonb_object_agg(day.day::text, day.payload order by day.day)
        from public.schedule_days as day
        where day.calendar_id = calendar.id
      ), '{}'::jsonb),
      'trocas', coalesce((
        select jsonb_agg(change.payload order by change.position)
        from public.schedule_changes as change
        where change.calendar_id = calendar.id
      ), '[]'::jsonb)
    )
  from public.schedule_calendars as calendar
  where calendar.calendar_key = p_calendar_key;
$$;

create or replace function public.replace_schedule_document(p_document jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated_at timestamptz := now();
  v_calendar2 jsonb;
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception 'schedule document must be a JSON object'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('divisao-equipe-madrugada:schedule'));

  delete from public.schedule_calendars;

  v_calendar2 := p_document -> 'calendario2';

  insert into public.schedule_state (
    singleton,
    document_meta,
    calendar2_meta,
    updated_at
  ) values (
    true,
    p_document - 'calendario1' - 'calendario2',
    case
      when jsonb_typeof(v_calendar2) = 'object'
        then v_calendar2 - 'rio_es' - 'leste'
      else '{}'::jsonb
    end,
    v_updated_at
  )
  on conflict (singleton) do update set
    document_meta = excluded.document_meta,
    calendar2_meta = excluded.calendar2_meta,
    updated_at = excluded.updated_at;

  perform app_private.insert_schedule_calendar('calendario1', p_document -> 'calendario1');

  if jsonb_typeof(v_calendar2 -> 'rio_es') = 'object'
     or jsonb_typeof(v_calendar2 -> 'leste') = 'object' then
    perform app_private.insert_schedule_calendar('calendario2.rio_es', v_calendar2 -> 'rio_es');
    perform app_private.insert_schedule_calendar('calendario2.leste', v_calendar2 -> 'leste');
  else
    perform app_private.insert_schedule_calendar('calendario2', v_calendar2);
  end if;

  return jsonb_build_object('updated_at', v_updated_at);
end;
$$;

create or replace function public.get_schedule_document()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_state public.schedule_state%rowtype;
  v_calendar1 jsonb;
  v_calendar2 jsonb;
  v_calendar2_direct jsonb;
  v_rio_es jsonb;
  v_leste jsonb;
begin
  select * into v_state
  from public.schedule_state
  where singleton = true;

  if not found then
    return null;
  end if;

  v_calendar1 := app_private.build_schedule_calendar('calendario1');
  v_calendar2_direct := app_private.build_schedule_calendar('calendario2');
  v_rio_es := app_private.build_schedule_calendar('calendario2.rio_es');
  v_leste := app_private.build_schedule_calendar('calendario2.leste');

  if v_calendar2_direct is not null then
    v_calendar2 := v_calendar2_direct;
  elsif v_rio_es is not null or v_leste is not null then
    v_calendar2 := v_state.calendar2_meta;
    if v_rio_es is not null then
      v_calendar2 := v_calendar2 || jsonb_build_object('rio_es', v_rio_es);
    end if;
    if v_leste is not null then
      v_calendar2 := v_calendar2 || jsonb_build_object('leste', v_leste);
    end if;
  else
    v_calendar2 := null;
  end if;

  return v_state.document_meta
    || jsonb_build_object(
      'calendario1', v_calendar1,
      'calendario2', v_calendar2
    );
end;
$$;

revoke all on function app_private.insert_schedule_calendar(text, jsonb) from public, anon, authenticated;
revoke all on function app_private.build_schedule_calendar(text) from public, anon, authenticated;
revoke all on function public.replace_schedule_document(jsonb) from public, anon, authenticated;
revoke all on function public.get_schedule_document() from public, anon, authenticated;

grant usage on schema app_private to service_role;
grant execute on function app_private.insert_schedule_calendar(text, jsonb) to service_role;
grant execute on function app_private.build_schedule_calendar(text) to service_role;
grant execute on function public.replace_schedule_document(jsonb) to service_role;
grant execute on function public.get_schedule_document() to service_role;
