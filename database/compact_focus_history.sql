-- Review before applying to production. Keeps a full private copy of the raw history.
-- Expected before: 1,330,760 rows; 267 distinct (user_id, day) pairs.
create schema if not exists maintenance;
revoke all on schema maintenance from public, anon, authenticated;
create table maintenance.focus_history_raw_20261113 as table public.focus_history;
revoke all on maintenance.focus_history_raw_20261113 from public, anon, authenticated;

create temporary table compact_focus_history as
select (array_agg(id order by focused_seconds desc nulls last, sessions_completed desc nulls last))[1] as id,
       user_id, day,
       max(focused_seconds) as focused_seconds,
       max(sessions_completed) as sessions_completed,
       min(created_at) as created_at
from public.focus_history
group by user_id, day;

truncate table public.focus_history;
insert into public.focus_history (id, user_id, day, focused_seconds, sessions_completed, created_at)
select id, user_id, day, focused_seconds, sessions_completed, created_at
from compact_focus_history;
alter table public.focus_history alter column user_id set not null;
alter table public.focus_history alter column day set not null;
alter table public.focus_history add constraint focus_history_user_day_key unique (user_id, day);
