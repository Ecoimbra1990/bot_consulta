do $$
begin
  begin
    perform cron.unschedule('sync-api-catalog');
  exception when others then
    null;
  end;
  begin
    perform cron.schedule(
      'sync-api-catalog',
      '0 3 * * *',
      $cmd$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-api-catalog', headers := jsonb_build_object('content-type', 'application/json', 'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_key')), body := jsonb_build_object('scheduled_at', now()), timeout_milliseconds := 60000)$cmd$
    );
  exception when others then
    null;
  end;
end
$$;
