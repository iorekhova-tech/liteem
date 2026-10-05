-- Лайтуем · миграция 05.10.2026
-- Запустить один раз: Supabase → SQL Editor → вставить → Run.

-- 1) Калькулятор КБЖУ: рост, возраст, вес, активность, цель и посчитанные ккал/Б/Ж/У.
--    Перекус, Б/Ж/У у записей еды и отметка «шаги уже в ленте» живут в daily_logs.meals (jsonb) — для них ничего не нужно.
alter table profiles add column if not exists body jsonb;

-- 2) Вечерний итог — в 23:59 МСК (было 21:30). pg_cron считает в UTC: 23:59 МСК = 20:59 UTC.
--    Меняется только время, секрет в задаче остаётся прежним.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'liteem-evening'),
  schedule := '59 20 * * *');

-- 3) Напоминание в личку в 21:00 МСК (18:00 UTC) — тем, у кого день не заполнен.
--    Команду копируем из вечерней задачи: адрес и секрет те же, меняется только режим.
--    Сводка недели отдельной задачи не требует — её шлёт вечерний итог по воскресеньям.
select cron.unschedule('liteem-remind') where exists (select 1 from cron.job where jobname = 'liteem-remind');
select cron.schedule('liteem-remind', '0 18 * * *',
  replace((select command from cron.job where jobname = 'liteem-evening'), '"mode":"evening"', '"mode":"remind"'));

-- проверка: select jobname, schedule, active, command like '%remind%' as ok from cron.job;
