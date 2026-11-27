do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    null;
  end;
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    null;
  end;
  begin
    create extension if not exists supabase_vault with schema extensions;
  exception when others then
    begin
      create extension if not exists pgcrypto with schema extensions;
    exception when others then
      null;
    end;
  end;
end
$$;

do $$
begin
  begin
    perform cron.unschedule('expire-subscriptions');
  exception when others then
    null;
  end;
  begin
    perform cron.schedule(
      'expire-subscriptions',
      '0 6 * * *',
      $cmd$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/expire-subscriptions', headers := jsonb_build_object('content-type', 'application/json', 'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_key')), body := jsonb_build_object('scheduled_at', now()), timeout_milliseconds := 60000)$cmd$
    );
  exception when others then
    null;
  end;
end
$$;

do $$
begin
  begin
    perform cron.unschedule('retention-purge');
  exception when others then
    null;
  end;
  begin
    perform cron.schedule(
      'retention-purge',
      '0 7 * * *',
      $cmd$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/retention-purge', headers := jsonb_build_object('content-type', 'application/json', 'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_key')), body := jsonb_build_object('scheduled_at', now()), timeout_milliseconds := 60000)$cmd$
    );
  exception when others then
    null;
  end;
end
$$;
