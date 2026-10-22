// Cliente de la API. Si el servidor no responde, el juego sigue en modo local (sin guardar).

let disponible = false;

async function pedir(metodo, ruta, cuerpo, { reintentos = 0 } = {}) {
  for (let intento = 0; ; intento++) {
    try {
      const control = new AbortController();
      const limite = setTimeout(() => control.abort(), 6000);
      const r = await fetch(`/api${ruta}`, {
        method: metodo,
        headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: control.signal,
      });
      clearTimeout(limite);
      const datos = await r.json().catch(() => null);
      if (!r.ok) {
        const error = new Error(datos?.error || `Error ${r.status}`);
        error.status = r.status;
        throw error;
      }
      return datos;
    } catch (error) {
      // Errores 4xx no se reintentan: repetir la petición daría el mismo resultado
      const definitivo = error.status && error.status < 500;
      if (definitivo || intento >= reintentos) throw error;
      await new Promise((r) => setTimeout(r, 500 * (intento + 1)));
    }
  }
}

export const api = {
  get disponible() {
    return disponible;
  },

  async conectar() {
    try {
      const salud = await pedir('GET', '/salud');
      disponible = salud.db === 'ok';
    } catch {
      disponible = false;
    }
    return disponible;
  },

  marcarCaido() {
    disponible = false;
  },

  registrarJugador: (nombre) => pedir('POST', '/jugadores', { nombre }, { reintentos: 1 }),
  historial: (jugadorId) => pedir('GET', `/jugadores/${jugadorId}/historial?limite=300`, null, { reintentos: 1 }),
  crearPartida: (jugadorId, dificultad, modo) =>
    pedir('POST', '/partidas', { jugador_id: jugadorId, dificultad, modo }, { reintentos: 1 }),
  // Reintentar una ronda es seguro: la base de datos ignora una ronda repetida
  registrarRonda: (partidaId, ronda) => pedir('POST', `/partidas/${partidaId}/rondas`, ronda, { reintentos: 2 }),
  terminarPartida: (partidaId) => pedir('POST', `/partidas/${partidaId}/terminar`, null, { reintentos: 1 }),
  ranking: () => pedir('GET', '/ranking'),
  estadisticas: () => pedir('GET', '/estadisticas/globales'),
};
