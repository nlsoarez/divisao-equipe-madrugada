-- Compact change index: one entry per record, including tombstones. No payload copies.
-- Do not prune tombstones until a cursor expiration/reset protocol is implemented.
create sequence app_private.operational_revision;
create table app_private.operational_changes (
  stream text not null,
  row_id bigint not null,
  revision bigint not null,
  born_revision bigint not null default 0,
  primary key (stream, row_id)
);
create index operational_changes_stream_revision_idx
  on app_private.operational_changes (stream, revision);
alter table app_private.operational_changes enable row level security;
grant select, insert, update on app_private.operational_changes to service_role;
grant usage, select on sequence app_private.operational_revision to service_role;

create function app_private.lock_operational_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(741932, 1);
  return null;
end;
$$;
create function app_private.track_operational_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_stream text; v_id bigint; v_revision bigint;
begin
  if TG_OP = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;
  if TG_TABLE_NAME = 'operational_messages' then
    v_stream := case when TG_OP = 'DELETE' then old.channel else new.channel end;
    if TG_OP = 'UPDATE' and old.channel <> new.channel then
      insert into app_private.operational_changes(stream,row_id,revision) values
        (old.channel, old.id, nextval('app_private.operational_revision'))
      on conflict (stream, row_id) do update set revision = excluded.revision;
    end if;
  else
    v_stream := 'alertas';
  end if;
  v_id := case when TG_OP = 'DELETE' then old.id else new.id end;
  v_revision := nextval('app_private.operational_revision');
  insert into app_private.operational_changes(stream,row_id,revision,born_revision) values
    (v_stream, v_id, v_revision, case when TG_OP='INSERT' then v_revision else 0 end)
  on conflict (stream, row_id) do update set revision = excluded.revision;
  return null;
end;
$$;
create trigger operational_messages_write_lock before insert or update or delete
  on public.operational_messages for each statement execute function app_private.lock_operational_write();
create trigger operational_alerts_write_lock before insert or update or delete
  on public.operational_alerts for each statement execute function app_private.lock_operational_write();
create trigger operational_messages_change after insert or update or delete
  on public.operational_messages for each row execute function app_private.track_operational_write();
create trigger operational_alerts_change after insert or update or delete
  on public.operational_alerts for each row execute function app_private.track_operational_write();

create view app_private.operational_feed with (security_invoker = true) as
select channel as stream, id, coalesce(event_at, created_at) as sort_at,
  event_at as filter_at, received_at, area_panel, original_group, responsible, message_type,
  null::text as status,
  payload || jsonb_build_object('id', coalesce(payload->>'id',record_id,message_id),
    'messageId',coalesce(payload->>'messageId',message_id),'_syncKey',id::text) as data
from public.operational_messages
union all
select 'alertas', id, coalesce(received_at,event_at,created_at), coalesce(received_at,event_at),
  received_at, area_panel, original_group, null, null, status,
  payload || jsonb_build_object('id',coalesce(payload->>'id',alert_id),
    'messageId',coalesce(payload->>'messageId',message_id),'statusAlerta',status,
    'status',case status when 'em_analise' then 'em_andamento' when 'tratado' then 'resolvido' else status end,
    'atualizadoEm',updated_at,'_syncKey',id::text)
from public.operational_alerts;
grant select on app_private.operational_feed to service_role;

create index operational_messages_history_idx on public.operational_messages
  (channel, (coalesce(event_at,created_at)) desc, id desc);
create index operational_alerts_history_idx on public.operational_alerts
  ((coalesce(received_at,event_at,created_at)) desc, id desc);

create function app_private.operational_matches(r app_private.operational_feed, f jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (f->>'dataInicio' is null or r.filter_at >= (f->>'dataInicio')::timestamptz)
    and (f->>'dataFim' is null or r.filter_at <= (f->>'dataFim')::timestamptz)
    and (f->>'areaPainel' is null or r.area_panel = f->>'areaPainel')
    and (f->>'statusAlerta' is null or r.status = f->>'statusAlerta')
    and (f->>'grupo' is null or strpos(lower(r.original_group),lower(f->>'grupo')) > 0)
    and (f->>'responsavel' is null or strpos(lower(r.responsible),lower(f->>'responsavel')) > 0)
    and (f->>'tipo' is null or strpos(lower(r.message_type),lower(f->>'tipo')) > 0)
    and (f->>'areaMapeada' is null or r.data->>'areaMapeada' = f->>'areaMapeada')
    and (f->>'data' is null or (r.received_at at time zone 'UTC')::date = (f->>'data')::date)
    and (f->>'busca' is null or exists (
      select 1 from unnest(array[r.data->>'empresa',r.data->>'descricao',r.data->>'grupo']) x
      where strpos(lower(x),lower(f->>'busca')) > 0));
$$;

create function public.operational_page(p_stream text, p_limit integer default 200,
  p_since bigint default null, p_before jsonb default null, p_filters jsonb default '{}')
returns jsonb language sql stable security invoker set search_path = '' as $$
  with watermark as (
    select coalesce(max(revision),0) as revision from app_private.operational_changes where stream=p_stream
  ), changes as materialized (
    select row_id, revision, born_revision from app_private.operational_changes
    where stream=p_stream and revision>p_since order by revision limit least(greatest(p_limit,1),500)+1
  ), delta as (
    select c.row_id, c.revision, case when app_private.operational_matches(r,p_filters)
      then r.data || jsonb_build_object('_createdRevision',c.born_revision::text) end as data
    from (select * from changes order by revision limit least(greatest(p_limit,1),500)) c
    left join app_private.operational_feed r on r.stream=p_stream and r.id=c.row_id
  ), recent as materialized (
    select r.id,r.sort_at,r.data from app_private.operational_feed r
    where p_since is null and r.stream=p_stream and app_private.operational_matches(r,p_filters)
      and (p_before is null or (r.sort_at,r.id) < ((p_before->>'at')::timestamptz,(p_before->>'id')::bigint))
    order by r.sort_at desc,r.id desc limit least(greatest(p_limit,1),500)+1
  ), page as (
    select * from recent order by sort_at desc,id desc limit least(greatest(p_limit,1),500)
  ), panel as (
    select r.data from app_private.operational_feed r where r.stream=p_stream
      and p_stream<>'alertas' and p_before is null
      and (p_since is null or exists(select 1 from changes))
      and jsonb_typeof(r.data->'resumo'->'grupo')='object' and r.data->'resumo'->'grupo'<>'{}'::jsonb
    order by r.sort_at desc,r.id desc limit 1
  )
  select case when p_since is not null then jsonb_build_object(
    'dados',coalesce((select jsonb_agg(data order by revision) filter(where data is not null) from delta),'[]'::jsonb),
    'removed',coalesce((select jsonb_agg(row_id::text) filter(where data is null) from delta),'[]'::jsonb),
    'cursor',(case when (select count(*) from changes)>p_limit then (select max(revision) from delta)
      else greatest(p_since,(select revision from watermark)) end)::text,
    'hasMore',(select count(*) from changes)>p_limit,
    'panel',(select data from panel)
  ) else jsonb_build_object(
    'dados',coalesce((select jsonb_agg(data order by sort_at desc,id desc) from page),'[]'::jsonb),
    'removed','[]'::jsonb,'cursor',(select revision::text from watermark),
    'hasMore',(select count(*) from recent)>p_limit,
    'before',(select jsonb_build_object('at',sort_at,'id',id::text) from page order by sort_at,id limit 1),
    'panel',(select data from panel)
  ) end;
$$;

create function public.operational_statistics(p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'totalCopRedeInforma',(select count(*) from public.operational_messages where channel='cop_rede_informa'),
    'copRedeInformaHoje',(select count(*) from public.operational_messages where channel='cop_rede_informa' and event_at>=p_start and event_at<p_end),
    'totalAlertas',(select count(*) from public.operational_alerts),
    'alertasHoje',(select count(*) from public.operational_alerts where coalesce(received_at,event_at)>=p_start and coalesce(received_at,event_at)<p_end),
    'alertasNovos',(select count(*) from public.operational_alerts where status='novo'),
    'alertasEmAnalise',(select count(*) from public.operational_alerts where status='em_analise'),
    'alertasTratados',(select count(*) from public.operational_alerts where status='tratado'),
    'volumePorArea',coalesce((select jsonb_object_agg(area_panel,volume) from (
      select area_panel,sum(coalesce(nullif(volume,0),1)) as volume from public.operational_messages
      where channel='cop_rede_informa' and event_at>=p_start and event_at<p_end and area_panel is not null group by area_panel
    ) areas),'{}'::jsonb),'ultimaAtualizacao',now());
$$;
create function public.operational_area_summary(p_start timestamptz default null,p_end timestamptz default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
    select area_panel as area,count(*) as quantidade,sum(coalesce(nullif(volume,0),1)) as "volumeTotal"
    from public.operational_messages where channel='cop_rede_informa'
      and (p_start is null or event_at>=p_start) and (p_end is null or event_at<=p_end) group by area_panel
  ) s;
$$;
create function public.hub_statistics() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('total',count(*),'diurno',count(*) filter(where allocation_type='DIURNO'),
    'madrugada',count(*) filter(where allocation_type='MADRUGADA'),'ultimaAtualizacao',now()) from public.hub_allocations;
$$;
create function public.operational_diagnostic_counts() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('totalMensagens',count(*),
    'mensagensComResumoGrupo',count(*) filter(where jsonb_typeof(payload->'resumo'->'grupo')='object' and payload->'resumo'->'grupo'<>'{}'::jsonb),
    'mensagensSemResumoGrupo',count(*) filter(where coalesce(jsonb_typeof(payload->'resumo'->'grupo')='object' and payload->'resumo'->'grupo'<>'{}'::jsonb,false)=false))
  from public.operational_messages where channel='cop_rede_informa';
$$;
revoke all on function public.operational_diagnostic_counts() from public,anon,authenticated;
grant execute on function public.operational_diagnostic_counts() to service_role;
revoke all on function app_private.lock_operational_write(), app_private.track_operational_write(),
  app_private.operational_matches(app_private.operational_feed,jsonb),
  public.operational_page(text,integer,bigint,jsonb,jsonb), public.operational_statistics(timestamptz,timestamptz),
  public.operational_area_summary(timestamptz,timestamptz), public.hub_statistics() from public,anon,authenticated;
grant execute on function app_private.lock_operational_write(), app_private.track_operational_write(),
  app_private.operational_matches(app_private.operational_feed,jsonb),
  public.operational_page(text,integer,bigint,jsonb,jsonb), public.operational_statistics(timestamptz,timestamptz),
  public.operational_area_summary(timestamptz,timestamptz), public.hub_statistics() to service_role;
