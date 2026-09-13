-- Лайтуем · миграция 13.09.2026
-- Запустить один раз: Supabase → SQL Editor → вставить → Run.
-- Сладкое и записи калорий хранятся в daily_logs.meals (jsonb), для них ничего не нужно.
-- Новые поля профиля: личная норма сладкого и норма калорий (для режима «Считаю калории»).

alter table profiles add column if not exists sweet_limit int default 100;
alter table profiles add column if not exists kcal_goal  int default 1500;
