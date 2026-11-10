-- MirrorLove 24/7: repair the join-session RPC and refresh PostgREST's schema cache.
-- Run this in the SQL Editor of the SAME Supabase project configured in Vercel.
-- Requires the public.sessions table from 001_initial.sql.

create or replace function public.join_session(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
  v_host_id uuid;
begin
  if auth.uid() is null then
    raise exception using message = 'Debes iniciar sesión para unirte.', errcode = '28000';
  end if;

  if p_code is null or upper(trim(p_code)) !~ '^[A-HJ-NP-Z2-9]{8}$' then
    raise exception using message = 'Código de invitación inválido. Debe tener 8 caracteres.', errcode = '22023';
  end if;

  select id, host_id
    into v_session_id, v_host_id
  from public.sessions
  where invite_code = upper(trim(p_code))
    and status = 'waiting'
    and viewer_id is null
  for update;

  if not found then
    raise exception using message = 'La sala no existe, ya tiene participante o ha finalizado. Solicita un código nuevo.', errcode = 'P0001';
  end if;

  if v_host_id = auth.uid() then
    raise exception using message = 'No puedes unirte a tu propia sala como espectador.', errcode = '42501';
  end if;

  update public.sessions
     set viewer_id = auth.uid()
   where id = v_session_id
     and viewer_id is null
     and status = 'waiting';

  if not found then
    raise exception using message = 'Otra persona acaba de ocupar esta sala. Solicita un código nuevo.', errcode = 'P0001';
  end if;

  return v_session_id;
end;
$$;

revoke all on function public.join_session(text) from public;
grant execute on function public.join_session(text) to authenticated;
grant select on public.sessions to authenticated;

-- Ask PostgREST to reload the function signature from PostgreSQL.
notify pgrst, 'reload schema';
