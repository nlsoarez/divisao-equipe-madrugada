-- Retention policy for operational data.
-- Messages: keep 2 days. Alerts: keep 1 day.
-- Runs hourly via Supabase Cron / pg_cron.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function app_private.cleanup_operational_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages_deleted bigint := 0;
  v_alerts_deleted bigint := 0;
begin
  delete from public.operational_messages
  where coalesce(event_at, created_at) < now() - interval '2 days';
  get diagnostics v_messages_deleted = row_count;

  delete from public.operational_alerts
  where coalesce(received_at, event_at, created_at) < now() - interval '1 day';
  get diagnostics v_alerts_deleted = row_count;

  return jsonb_build_object(
    'messages_deleted', v_messages_deleted,
    'alerts_deleted', v_alerts_deleted,
    'ran_at', now()
  );
end;
$$;

revoke all on function app_private.cleanup_operational_retention() from public, anon, authenticated;
grant execute on function app_private.cleanup_operational_retention() to service_role;

select cron.schedule(
  'cleanup-operational-retention',
  '17 * * * *',
  $$select app_private.cleanup_operational_retention();$$
);
