create or replace function public.clear_schedule_document()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('divisao-equipe-madrugada:schedule'));
  delete from public.schedule_calendars where id > 0;
  delete from public.schedule_state where singleton = true;
end;
$$;

revoke all on function public.clear_schedule_document() from public, anon, authenticated;
grant execute on function public.clear_schedule_document() to service_role;
