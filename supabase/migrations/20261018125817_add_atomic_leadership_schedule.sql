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

  delete from public.schedule_calendars where id > 0;
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
    document_meta = case
      when p_document ? 'lideranca' then excluded.document_meta
      when public.schedule_state.document_meta ? 'lideranca' then
        excluded.document_meta || jsonb_build_object(
          'lideranca', public.schedule_state.document_meta -> 'lideranca'
        )
      else excluded.document_meta
    end,
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

create or replace function public.set_schedule_leadership(p_leadership jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated_at timestamptz := now();
begin
  if p_leadership is null
     or jsonb_typeof(p_leadership) <> 'object'
     or jsonb_typeof(p_leadership -> 'dias') <> 'object' then
    raise exception 'leadership schedule must contain a dias object'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('divisao-equipe-madrugada:schedule'));

  update public.schedule_state
  set document_meta = jsonb_set(
        coalesce(document_meta, '{}'::jsonb),
        '{lideranca}',
        p_leadership,
        true
      ),
      updated_at = v_updated_at
  where singleton = true;

  if not found then
    raise exception 'schedule state is not initialized'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'updated_at', v_updated_at,
    'days', (select count(*) from jsonb_object_keys(p_leadership -> 'dias'))
  );
end;
$$;

revoke all on function public.replace_schedule_document(jsonb) from public, anon, authenticated;
revoke all on function public.set_schedule_leadership(jsonb) from public, anon, authenticated;
grant execute on function public.replace_schedule_document(jsonb) to service_role;
grant execute on function public.set_schedule_leadership(jsonb) to service_role;
