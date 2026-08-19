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

revoke all on function public.replace_schedule_document(jsonb) from public, anon, authenticated;
grant execute on function public.replace_schedule_document(jsonb) to service_role;
