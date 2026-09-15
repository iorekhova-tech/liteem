-- Лайтуем · расписание утра, вечера и среза по воде в Supabase (pg_cron + pg_net).
-- Запускать в SQL Editor один раз. Время pg_cron — UTC, МСК = UTC+3.
-- <CRON_SECRET> заменить на значение секрета CRON_SECRET функции daily-digest
-- (настоящее значение в публичную репу не класть).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- повторный запуск скрипта не плодит задачи
select cron.unschedule(jobname) from cron.job
 where jobname in ('liteem-morning', 'liteem-evening', 'liteem-water');

select cron.schedule('liteem-morning', '0 5 * * *',      -- 08:00 МСК
  $$select net.http_post(
      url     := 'https://mikubhndfhhtoswletmj.supabase.co/functions/v1/daily-digest',
      headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
      body    := '{"mode":"morning"}'::jsonb)$$);

select cron.schedule('liteem-evening', '30 18 * * *',    -- 21:30 МСК
  $$select net.http_post(
      url     := 'https://mikubhndfhhtoswletmj.supabase.co/functions/v1/daily-digest',
      headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
      body    := '{"mode":"evening"}'::jsonb)$$);

select cron.schedule('liteem-water', '0 9,13,17 * * *',  -- 12:00, 16:00, 20:00 МСК
  $$select net.http_post(
      url     := 'https://mikubhndfhhtoswletmj.supabase.co/functions/v1/daily-digest',
      headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
      body    := '{"mode":"water"}'::jsonb)$$);

-- проверка: select jobname, schedule, active from cron.job;
-- история:  select * from cron.job_run_details order by start_time desc limit 10;
