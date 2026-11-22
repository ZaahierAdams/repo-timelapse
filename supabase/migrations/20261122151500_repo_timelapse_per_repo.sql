-- One row per repo, written by that repo's own workflow run (token-free, GitHub OIDC).
create table if not exists repo_stats.repos (
  name text primary key,
  data jsonb not null,
  generated_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table repo_stats.repos enable row level security;
revoke all on repo_stats.repos from public, anon, authenticated;

insert into repo_stats.repos (name, data, generated_at)
select r->>'name', r, d.generated_at
from repo_stats.dataset d, jsonb_array_elements(d.data->'repos') r
where d.id = 1
on conflict (name) do nothing;

create or replace function public.repo_timelapse_upsert_repo(repo_name text, payload jsonb, generated timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if payload is null or jsonb_typeof(payload) <> 'object' or jsonb_typeof(payload->'series') <> 'array' then
    raise exception 'invalid repo payload';
  end if;
  insert into repo_stats.repos (name, data, generated_at, updated_at)
  values (repo_name, payload || jsonb_build_object('name', repo_name), coalesce(generated, now()), now())
  on conflict (name) do update set data = excluded.data, generated_at = excluded.generated_at, updated_at = now();
end; $$;
revoke all on function public.repo_timelapse_upsert_repo(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.repo_timelapse_upsert_repo(text, jsonb, timestamptz) to service_role;

create or replace function public.repo_timelapse_delete_repo(repo_name text)
returns void language sql security definer set search_path = '' as $$
  delete from repo_stats.repos where name = repo_name;
$$;
revoke all on function public.repo_timelapse_delete_repo(text) from public, anon, authenticated;
grant execute on function public.repo_timelapse_delete_repo(text) to service_role;

create or replace function public.repo_timelapse_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ok boolean; latest timestamptz;
begin
  select exists (
    select 1 from auth.identities i
    join repo_stats.allowed_viewers v on v.email = lower(i.identity_data->>'email')
    where i.user_id = auth.uid()
      and i.provider = 'google'
      and coalesce((i.identity_data->>'email_verified')::boolean, false)
  ) into ok;
  if not ok then raise exception 'not authorized' using errcode = '42501'; end if;
  select max(updated_at) into latest from repo_stats.repos;
  return jsonb_build_object(
    'generated_at', latest, 'updated_at', latest,
    'data', jsonb_build_object(
      'generated_at', latest, 'tz', 'Africa/Johannesburg', 'owner', 'ZaahierAdams',
      'repos', coalesce((select jsonb_agg(r.data order by r.data->>'first_day') from repo_stats.repos r), '[]'::jsonb)
    )
  );
end; $$;
revoke all on function public.repo_timelapse_get() from public, anon;
grant execute on function public.repo_timelapse_get() to authenticated;
