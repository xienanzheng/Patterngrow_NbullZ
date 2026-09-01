-- Align existing forecast_log tables with the backend upsert conflict target.
-- Existing data is safe: the old two-column constraint already prevented
-- duplicates for the new three-column key.
alter table public.forecast_log
  drop constraint if exists forecast_log_symbol_snapshot_date_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'forecast_log_symbol_snapshot_date_forecast_model_key'
      and conrelid = 'public.forecast_log'::regclass
  ) then
    alter table public.forecast_log
      add constraint forecast_log_symbol_snapshot_date_forecast_model_key
      unique (symbol, snapshot_date, forecast_model);
  end if;
end
$$;
