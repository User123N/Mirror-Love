-- MirrorLove: reliable room creation through a narrowly scoped server-side RPC.
-- Safe to run after 001_initial.sql. It does not expose service_role to the browser.

create or replace function public.create_session(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para crear una sala.';
  end if;

  if p_invite_code is null or p_invite_code !~ '^[A-HJ-NP-Z2-9]{8}$' then
    raise exception 'El código de invitación no tiene el formato esperado.';
  end if;

  insert into public.sessions (host_id, invite_code, status)
  values (auth.uid(), upper(p_invite_code), 'waiting')
  returning id into v_session_id;

  return v_session_id;
end;
$$;

revoke all on function public.create_session(text) from public;
grant execute on function public.create_session(text) to authenticated;

-- Ensure authenticated clients can read their own newly created room.
grant select, insert on public.sessions to authenticated;
