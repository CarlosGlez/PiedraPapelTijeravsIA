// Acceso a Supabase. Todo lo que toca la base de datos vive aquí.
import { createClient } from '@supabase/supabase-js';

export class DbError extends Error {
  constructor(error) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
}

export function crearDb({ url, key }) {
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // supabase-js no lanza errores: los devuelve en { error }. Aquí los convertimos en excepciones.
  const datos = ({ data, error }) => {
    if (error) throw new DbError(error);
    return data;
  };

  return {
    async salud() {
      datos(await sb.from('jugadores').select('id', { head: true, count: 'exact' }).limit(1));
    },

    async registrarJugador(nombre) {
      return datos(await sb.rpc('registrar_jugador', { p_nombre: nombre }));
    },

    async historial(jugadorId, limite) {
      return datos(await sb.rpc('historial_jugador', { p_jugador_id: jugadorId, p_limite: limite }));
    },

    async crearPartida({ jugadorId, dificultad, modo }) {
      return datos(
        await sb
          .from('partidas')
          .insert({ jugador_id: jugadorId, dificultad, modo })
          .select()
          .single()
      );
    },

    async registrarRonda({ partidaId, numero, tiroJugador, tiroIa, prediccion, tiroTardio }) {
      return datos(
        await sb.rpc('registrar_ronda', {
          p_partida_id: partidaId,
          p_numero: numero,
          p_tiro_jugador: tiroJugador,
          p_tiro_ia: tiroIa,
          p_prediccion: prediccion,
          p_tiro_tardio: tiroTardio,
        })
      );
    },

    async terminarPartida(partidaId) {
      return datos(await sb.rpc('terminar_partida', { p_partida_id: partidaId }));
    },

    async ranking() {
      return datos(
        await sb
          .from('ranking')
          .select('nombre, rondas, victorias, derrotas, empates, porcentaje_victorias')
          .order('porcentaje_victorias', { ascending: false })
          .order('rondas', { ascending: false })
          .limit(10)
      );
    },

    async estadisticasGlobales() {
      return datos(await sb.rpc('estadisticas_globales'));
    },
  };
}
