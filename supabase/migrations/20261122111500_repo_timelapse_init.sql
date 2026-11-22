-- Repo Timelapse: private stats store, isolated from the Nest app (applied to the Nest-app project).
create schema if not exists repo_stats;
revoke all on schema repo_stats from public, anon, authenticated;

create table if not exists repo_stats.dataset (
  id smallint primary key default 1 check (id = 1),
  generated_at timestamptz not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table repo_stats.dataset enable row level security;

create table if not exists repo_stats.allowed_viewers (
  email text primary key check (email = lower(email))
);
alter table repo_stats.allowed_viewers enable row level security;
insert into repo_stats.allowed_viewers (email) values ('zaahier.ada@gmail.com') on conflict do nothing;

revoke all on all tables in schema repo_stats from public, anon, authenticated;

-- Read: only a signed-in user whose *Google* identity carries a verified, allow-listed email.
create or replace function public.repo_timelapse_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  select exists (
    select 1 from auth.identities i
    join repo_stats.allowed_viewers v on v.email = lower(i.identity_data->>'email')
    where i.user_id = auth.uid()
      and i.provider = 'google'
      and coalesce((i.identity_data->>'email_verified')::boolean, false)
  ) into ok;
  if not ok then raise exception 'not authorized' using errcode = '42501'; end if;
  return (select jsonb_build_object('generated_at', d.generated_at, 'updated_at', d.updated_at, 'data', d.data)
          from repo_stats.dataset d where d.id = 1);
end; $$;
revoke all on function public.repo_timelapse_get() from public, anon;
grant execute on function public.repo_timelapse_get() to authenticated;

-- Write: service_role only (the ingest edge function, after verifying the GitHub OIDC token).
create or replace function public.repo_timelapse_ingest(payload jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare gen timestamptz := coalesce((payload->>'generated_at')::timestamptz, now());
begin
  if jsonb_typeof(payload->'repos') is distinct from 'array' then
    raise exception 'payload.repos must be an array';
  end if;
  insert into repo_stats.dataset (id, generated_at, data, updated_at) values (1, gen, payload, now())
  on conflict (id) do update set generated_at = excluded.generated_at, data = excluded.data, updated_at = now();
  return gen;
end; $$;
revoke all on function public.repo_timelapse_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.repo_timelapse_ingest(jsonb) to service_role;
