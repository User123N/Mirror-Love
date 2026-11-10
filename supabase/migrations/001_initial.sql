-- MirrorLove 24/7: initial schema. Run in Supabase SQL Editor as project owner.
-- The browser must use only the publishable/anon key. Never expose service_role.

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid references auth.users(id) on delete set null,
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  status text not null default 'waiting' check (status in ('waiting','live','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_distinct_participants check (viewer_id is null or viewer_id <> host_id)
);

create index if not exists sessions_host_created_idx on public.sessions(host_id, created_at desc);
create index if not exists sessions_viewer_created_idx on public.sessions(viewer_id, created_at desc);

create table if not exists public.signals (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('offer','answer','ice','hangup')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists signals_session_id_idx on public.signals(session_id, id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at before update on public.sessions
for each row execute function public.set_updated_at();

alter table public.sessions enable row level security;
alter table public.signals enable row level security;

-- Participants can read their own session. The invite code is not enumerable by strangers.
drop policy if exists "participants read sessions" on public.sessions;
create policy "participants read sessions" on public.sessions
for select to authenticated
using (auth.uid() = host_id or auth.uid() = viewer_id);

-- A signed-in user can create a room only as its host.
drop policy if exists "users create own sessions" on public.sessions;
create policy "users create own sessions" on public.sessions
for insert to authenticated
with check (auth.uid() = host_id and viewer_id is null and status = 'waiting');

-- Host can update status; participant can only end their session. They cannot reassign participants.
drop policy if exists "participants update session status" on public.sessions;
create policy "participants update session status" on public.sessions
for update to authenticated
using (auth.uid() = host_id or auth.uid() = viewer_id)
with check (
  (auth.uid() = host_id and host_id = auth.uid())
  or (auth.uid() = viewer_id and viewer_id = auth.uid())
);

-- Signal messages are visible only to the two authenticated participants.
drop policy if exists "participants read signals" on public.signals;
create policy "participants read signals" on public.signals
for select to authenticated
using (exists (
  select 1 from public.sessions s
  where s.id = signals.session_id and (s.host_id = auth.uid() or s.viewer_id = auth.uid())
));

drop policy if exists "participants send signals" on public.signals;
create policy "participants send signals" on public.signals
for insert to authenticated
with check (
  sender_id = auth.uid() and exists (
    select 1 from public.sessions s
    where s.id = signals.session_id and s.status <> 'ended'
      and (s.host_id = auth.uid() or s.viewer_id = auth.uid())
  )
);

-- Joining is performed by this function so the invite code is never exposed in a public SELECT.
create or replace function public.join_session(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión para unirte.'; end if;
  if p_code is null or p_code !~ '^[A-HJ-NP-Z2-9]{8}$' then raise exception 'Código de invitación inválido.'; end if;

  select * into v_session from public.sessions
  where invite_code = upper(p_code) and status = 'waiting' and viewer_id is null
  for update;

  if not found then raise exception 'La sala no existe, ya tiene participante o ha finalizado.'; end if;
  if v_session.host_id = auth.uid() then raise exception 'No puedes unirte a tu propia sala como espectador.'; end if;

  update public.sessions set viewer_id = auth.uid() where id = v_session.id;
  return v_session.id;
end;
$$;
revoke all on function public.join_session(text) from public;
grant execute on function public.join_session(text) to authenticated;

-- Enable Postgres Changes for the signal table. Realtime is filtered by RLS.
do $$
begin
  alter publication supabase_realtime add table public.sessions;
exception when duplicate_object then null;
when undefined_object then raise notice 'Publication supabase_realtime not found; enable Realtime for sessions manually.';
end $$;
do $$
begin
  alter publication supabase_realtime add table public.signals;
exception when duplicate_object then null;
when undefined_object then raise notice 'Publication supabase_realtime not found; enable Realtime for signals manually.';
end $$;

grant select, insert on public.sessions to authenticated;
grant update (status) on public.sessions to authenticated;
grant select, insert on public.signals to authenticated;
grant usage, select on sequence public.signals_id_seq to authenticated;
