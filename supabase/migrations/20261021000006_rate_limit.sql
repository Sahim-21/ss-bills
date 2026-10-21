-- Rate limiting for the restaurant-facing Edge Functions (activate, sync).
-- One row per limit key (for example "activate:ip:1.2.3.4"); a fixed window that restarts when it expires.
-- Only the service role (the Edge Functions) can call it, and the table is not reachable by anyone else.

create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         integer not null
);
create index idx_rate_limits_window on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Counts this attempt and says whether it is still within the limit.
create function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_hits integer;
begin
  if p_key is null or length(p_key) > 200 or p_max < 1 or p_window_seconds < 1 then
    raise exception 'Bad rate limit arguments';
  end if;
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning hits into v_hits;
  -- housekeeping: forget anything idle for a day
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_max;
end $$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
