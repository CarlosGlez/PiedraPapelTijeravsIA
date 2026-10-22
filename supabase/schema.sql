-- =====================================================================
--  Piedra, Papel o Tijera vs IA — esquema de base de datos (Supabase)
--  Pégalo completo en Supabase → SQL Editor → Run.
--  Se puede volver a ejecutar sin romper nada (usa "if not exists" / "or replace").
-- =====================================================================

-- ---------- Tablas ----------

create table if not exists public.jugadores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(trim(nombre)) between 1 and 30),
  creado_en  timestamptz not null default now()
);

-- Un nombre identifica a un jugador sin importar mayúsculas o espacios ("Carlos" = " carlos ")
create unique index if not exists jugadores_nombre_unico
  on public.jugadores (lower(trim(nombre)));

create table if not exists public.partidas (
  id                 uuid primary key default gen_random_uuid(),
  jugador_id         uuid not null references public.jugadores (id) on delete cascade,
  dificultad         text not null check (dificultad in ('facil', 'normal', 'dificil', 'imposible')),
  modo               text not null check (modo in ('libre', 'mejor_de_3', 'mejor_de_5')),
  victorias_jugador  int  not null default 0 check (victorias_jugador >= 0),
  victorias_ia       int  not null default 0 check (victorias_ia >= 0),
  empates            int  not null default 0 check (empates >= 0),
  ganador            text check (ganador in ('jugador', 'ia', 'empate')),
  iniciada_en        timestamptz not null default now(),
  terminada_en       timestamptz,
  -- una partida terminada siempre tiene ganador, y viceversa
  check ((terminada_en is null) = (ganador is null))
);

create index if not exists partidas_jugador_idx on public.partidas (jugador_id);

create table if not exists public.rondas (
  id                 bigint generated always as identity primary key,
  partida_id         uuid not null references public.partidas (id) on delete cascade,
  numero             int  not null check (numero > 0),
  tiro_jugador       text not null check (tiro_jugador in ('piedra', 'papel', 'tijera')),
  tiro_ia            text not null check (tiro_ia      in ('piedra', 'papel', 'tijera')),
  resultado          text not null check (resultado in ('gana_jugador', 'gana_ia', 'empate')),
  prediccion         text check (prediccion in ('piedra', 'papel', 'tijera')),
  acerto_prediccion  boolean,
  tiro_tardio        boolean not null default false,
  creada_en          timestamptz not null default now(),
  -- (partida, número) es único: si el cliente reintenta una ronda, no se duplica
  unique (partida_id, numero)
);

-- ---------- Seguridad ----------
-- Solo el backend (con la secret/service_role key) toca estas tablas.
-- RLS activado sin políticas = el navegador con la anon key no puede leer ni escribir nada.

alter table public.jugadores enable row level security;
alter table public.partidas  enable row level security;
alter table public.rondas    enable row level security;

revoke all on public.jugadores, public.partidas, public.rondas from anon, authenticated;

-- ---------- Funciones ----------

-- Registra (o recupera) un jugador por nombre.
create or replace function public.registrar_jugador(p_nombre text)
returns public.jugadores
language plpgsql
set search_path = ''
as $$
declare
  v_jugador public.jugadores;
begin
  insert into public.jugadores (nombre)
  values (trim(p_nombre))
  on conflict ((lower(trim(nombre)))) do nothing
  returning * into v_jugador;

  if v_jugador.id is null then
    select * into v_jugador
    from public.jugadores
    where lower(trim(nombre)) = lower(trim(p_nombre));
  end if;

  return v_jugador;
end;
$$;

-- Registra una ronda y actualiza el marcador de la partida en una sola transacción.
-- El resultado lo calcula la base de datos: no se confía en lo que diga el cliente.
-- Es idempotente: si la ronda (partida, número) ya existe, devuelve la partida sin cambios.
create or replace function public.registrar_ronda(
  p_partida_id   uuid,
  p_numero       int,
  p_tiro_jugador text,
  p_tiro_ia      text,
  p_prediccion   text,
  p_tiro_tardio  boolean
)
returns public.partidas
language plpgsql
set search_path = ''
as $$
declare
  v_partida   public.partidas;
  v_resultado text;
  v_meta      int;
  v_filas     int;
begin
  -- Bloquea la partida para que dos rondas simultáneas no pisen el marcador
  select * into v_partida from public.partidas where id = p_partida_id for update;
  if not found then
    raise exception 'partida_no_encontrada' using errcode = 'P0002';
  end if;

  if v_partida.terminada_en is not null then
    -- Reintento de la ronda que cerró la partida: devolverla tal cual
    if exists (select 1 from public.rondas where partida_id = p_partida_id and numero = p_numero) then
      return v_partida;
    end if;
    raise exception 'partida_terminada' using errcode = 'P0001';
  end if;

  v_resultado := case
    when p_tiro_jugador = p_tiro_ia then 'empate'
    when (p_tiro_jugador, p_tiro_ia) in (('piedra', 'tijera'), ('papel', 'piedra'), ('tijera', 'papel'))
      then 'gana_jugador'
    else 'gana_ia'
  end;

  insert into public.rondas
    (partida_id, numero, tiro_jugador, tiro_ia, resultado, prediccion, acerto_prediccion, tiro_tardio)
  values
    (p_partida_id, p_numero, p_tiro_jugador, p_tiro_ia, v_resultado, p_prediccion,
     case when p_prediccion is null then null else p_prediccion = p_tiro_jugador end,
     coalesce(p_tiro_tardio, false))
  on conflict (partida_id, numero) do nothing;

  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    return v_partida; -- ya estaba registrada
  end if;

  update public.partidas set
    victorias_jugador = victorias_jugador + (v_resultado = 'gana_jugador')::int,
    victorias_ia      = victorias_ia      + (v_resultado = 'gana_ia')::int,
    empates           = empates           + (v_resultado = 'empate')::int
  where id = p_partida_id
  returning * into v_partida;

  -- Modo torneo: gana quien llegue primero a 2 (mejor de 3) o 3 (mejor de 5)
  v_meta := case v_partida.modo when 'mejor_de_3' then 2 when 'mejor_de_5' then 3 end;
  if v_meta is not null
     and (v_partida.victorias_jugador >= v_meta or v_partida.victorias_ia >= v_meta) then
    update public.partidas set
      ganador      = case when victorias_jugador >= v_meta then 'jugador' else 'ia' end,
      terminada_en = now()
    where id = p_partida_id
    returning * into v_partida;
  end if;

  return v_partida;
end;
$$;

-- Cierra una partida libre (o abandona un torneo) calculando el ganador por marcador.
create or replace function public.terminar_partida(p_partida_id uuid)
returns public.partidas
language plpgsql
set search_path = ''
as $$
declare
  v_partida public.partidas;
begin
  update public.partidas set
    ganador = case
      when victorias_jugador > victorias_ia then 'jugador'
      when victorias_ia > victorias_jugador then 'ia'
      else 'empate'
    end,
    terminada_en = now()
  where id = p_partida_id and terminada_en is null
  returning * into v_partida;

  if v_partida.id is null then
    select * into v_partida from public.partidas where id = p_partida_id;
    if not found then
      raise exception 'partida_no_encontrada' using errcode = 'P0002';
    end if;
  end if;

  return v_partida;
end;
$$;

-- Últimas rondas de un jugador (en orden cronológico) para que la IA lo "recuerde".
create or replace function public.historial_jugador(p_jugador_id uuid, p_limite int default 300)
returns table (tiro_jugador text, resultado text, dificultad text, creada_en timestamptz)
language sql
stable
set search_path = ''
as $$
  select r.tiro_jugador, r.resultado, r.dificultad, r.creada_en
  from (
    select r.tiro_jugador, r.resultado, p.dificultad, r.creada_en, r.id
    from public.rondas r
    join public.partidas p on p.id = r.partida_id
    where p.jugador_id = p_jugador_id
    order by r.id desc
    limit least(greatest(p_limite, 1), 1000)
  ) r
  order by r.id;
$$;

-- Estadísticas de TODOS los jugadores: la "IA colectiva" del modo difícil.
--   tiros:          cuántas veces se ha sacado cada cosa
--   aperturas:      qué saca la gente en la primera ronda
--   transiciones:   qué saca la gente después de cada tiro  { anterior: { siguiente: n } }
--   tras_resultado: qué saca la gente después de ganar/perder/empatar
create or replace function public.estadisticas_globales()
returns json
language sql
stable
set search_path = ''
as $$
  with ordenadas as (
    select
      r.numero,
      r.tiro_jugador,
      lag(r.tiro_jugador) over w as anterior,
      lag(r.resultado)    over w as resultado_anterior,
      p.jugador_id
    from public.rondas r
    join public.partidas p on p.id = r.partida_id
    window w as (partition by r.partida_id order by r.numero)
  )
  select json_build_object(
    'total_rondas',    (select count(*) from ordenadas),
    'total_jugadores', (select count(distinct jugador_id) from ordenadas),
    'tiros', (
      select coalesce(json_object_agg(tiro_jugador, n), '{}'::json)
      from (select tiro_jugador, count(*) as n from ordenadas group by 1) t
    ),
    'aperturas', (
      select coalesce(json_object_agg(tiro_jugador, n), '{}'::json)
      from (select tiro_jugador, count(*) as n from ordenadas where numero = 1 group by 1) t
    ),
    'transiciones', (
      select coalesce(json_object_agg(anterior, siguientes), '{}'::json)
      from (
        select anterior, json_object_agg(tiro_jugador, n) as siguientes
        from (
          select anterior, tiro_jugador, count(*) as n
          from ordenadas where anterior is not null group by 1, 2
        ) x
        group by anterior
      ) y
    ),
    'tras_resultado', (
      select coalesce(json_object_agg(resultado_anterior, siguientes), '{}'::json)
      from (
        select resultado_anterior, json_object_agg(tiro_jugador, n) as siguientes
        from (
          select resultado_anterior, tiro_jugador, count(*) as n
          from ordenadas where resultado_anterior is not null group by 1, 2
        ) x
        group by resultado_anterior
      ) y
    )
  );
$$;

-- Solo el backend puede ejecutar estas funciones
revoke execute on function public.registrar_jugador(text)                                  from public, anon, authenticated;
revoke execute on function public.registrar_ronda(uuid, int, text, text, text, boolean)    from public, anon, authenticated;
revoke execute on function public.terminar_partida(uuid)                                   from public, anon, authenticated;
revoke execute on function public.historial_jugador(uuid, int)                             from public, anon, authenticated;
revoke execute on function public.estadisticas_globales()                                  from public, anon, authenticated;

-- ---------- Ranking ----------
-- Solo cuentan rondas en Normal y Difícil (en Fácil la IA tira al azar y en Imposible hace trampa).
-- Mínimo 10 rondas para aparecer.
create or replace view public.ranking
with (security_invoker = true)
as
select
  j.id,
  j.nombre,
  count(*)                                              as rondas,
  count(*) filter (where r.resultado = 'gana_jugador')  as victorias,
  count(*) filter (where r.resultado = 'gana_ia')       as derrotas,
  count(*) filter (where r.resultado = 'empate')        as empates,
  round(100.0 * count(*) filter (where r.resultado = 'gana_jugador') / count(*), 1) as porcentaje_victorias
from public.jugadores j
join public.partidas p on p.jugador_id = j.id
join public.rondas   r on r.partida_id = p.id
where p.dificultad in ('normal', 'dificil')
group by j.id, j.nombre
having count(*) >= 10;

revoke all on public.ranking from anon, authenticated;

-- El backend usa el rol service_role (secret key): se le dan permisos de forma explícita
grant select, insert, update, delete on public.jugadores, public.partidas, public.rondas to service_role;
grant select on public.ranking to service_role;
grant execute on function public.registrar_jugador(text)                               to service_role;
grant execute on function public.registrar_ronda(uuid, int, text, text, text, boolean) to service_role;
grant execute on function public.terminar_partida(uuid)                                to service_role;
grant execute on function public.historial_jugador(uuid, int)                          to service_role;
grant execute on function public.estadisticas_globales()                               to service_role;
