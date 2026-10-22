// API REST del juego. Recibe el objeto `db` para poder probarla sin Supabase.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIROS = ['piedra', 'papel', 'tijera'];
const DIFICULTADES = ['facil', 'normal', 'dificil', 'imposible'];
const MODOS = ['libre', 'mejor_de_3', 'mejor_de_5'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Validación de entradas ----------
const uuid = (valor, campo) => {
  if (typeof valor !== 'string' || !UUID.test(valor)) throw new HttpError(400, `${campo} no es un id válido`);
  return valor;
};
const unoDe = (valor, opciones, campo) => {
  if (!opciones.includes(valor)) throw new HttpError(400, `${campo} debe ser uno de: ${opciones.join(', ')}`);
  return valor;
};
const entero = (valor, campo, min, max) => {
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new HttpError(400, `${campo} debe ser un entero entre ${min} y ${max}`);
  }
  return valor;
};

// ---------- Errores de la base de datos → respuestas HTTP ----------
function traducirErrorDb(err) {
  if (err.code === 'P0002' || err.message === 'partida_no_encontrada') return new HttpError(404, 'La partida no existe');
  if (err.message === 'partida_terminada') return new HttpError(409, 'La partida ya terminó');
  if (err.code === '23503') return new HttpError(404, 'El jugador no existe');
  if (err.code === '23514' || err.code === '22P02') return new HttpError(400, 'Datos inválidos');
  return null;
}

export function crearApp(db) {
  const app = express();

  // Log de cada petición: método, ruta, estado y duración
  app.use((req, res, next) => {
    const inicio = performance.now();
    res.on('finish', () => {
      if (!req.path.startsWith('/api')) return;
      const ms = (performance.now() - inicio).toFixed(0);
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    });
    next();
  });

  const api = express.Router();
  // Dentro del router, así un JSON mal formado llega al manejador de errores de la API
  api.use(express.json({ limit: '10kb' }));

  // Si Supabase no está configurado, la API responde 503 y el juego funciona sin guardar nada
  api.use((req, res, next) => {
    if (!db && req.path !== '/salud') throw new HttpError(503, 'El servidor no tiene Supabase configurado');
    next();
  });

  api.get('/salud', async (req, res) => {
    if (!db) return res.json({ ok: true, db: 'sin_configurar' });
    try {
      await db.salud();
      res.json({ ok: true, db: 'ok' });
    } catch (err) {
      console.error('Supabase no responde:', err.message);
      res.status(503).json({ ok: false, db: 'error' });
    }
  });

  api.post('/jugadores', async (req, res) => {
    const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
    if (nombre.length < 1 || nombre.length > 30) throw new HttpError(400, 'El nombre debe tener entre 1 y 30 caracteres');
    res.status(201).json(await db.registrarJugador(nombre));
  });

  api.get('/jugadores/:id/historial', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const limite = req.query.limite ? entero(Number(req.query.limite), 'limite', 1, 1000) : 300;
    res.json(await db.historial(id, limite));
  });

  api.post('/partidas', async (req, res) => {
    const b = req.body ?? {};
    const partida = await db.crearPartida({
      jugadorId: uuid(b.jugador_id, 'jugador_id'),
      dificultad: unoDe(b.dificultad, DIFICULTADES, 'dificultad'),
      modo: unoDe(b.modo, MODOS, 'modo'),
    });
    res.status(201).json(partida);
  });

  api.post('/partidas/:id/rondas', async (req, res) => {
    const b = req.body ?? {};
    const prediccion = b.prediccion ?? null;
    if (prediccion !== null) unoDe(prediccion, TIROS, 'prediccion');
    const partida = await db.registrarRonda({
      partidaId: uuid(req.params.id, 'id'),
      numero: entero(b.numero, 'numero', 1, 10000),
      tiroJugador: unoDe(b.tiro_jugador, TIROS, 'tiro_jugador'),
      tiroIa: unoDe(b.tiro_ia, TIROS, 'tiro_ia'),
      prediccion,
      tiroTardio: b.tiro_tardio === true,
    });
    res.json(partida);
  });

  api.post('/partidas/:id/terminar', async (req, res) => {
    res.json(await db.terminarPartida(uuid(req.params.id, 'id')));
  });

  api.get('/ranking', async (req, res) => {
    res.json(await db.ranking());
  });

  // Las estadísticas globales cambian poco: se guardan 30 s en memoria para no recalcularlas cada partida
  let cache = { datos: null, hasta: 0 };
  api.get('/estadisticas/globales', async (req, res) => {
    if (Date.now() > cache.hasta) {
      cache = { datos: await db.estadisticasGlobales(), hasta: Date.now() + 30_000 };
    }
    res.json(cache.datos);
  });

  api.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Manejo central de errores: el cliente recibe un mensaje claro, el detalle queda en el log del servidor
  api.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'JSON inválido');
    const http = err instanceof HttpError ? err : traducirErrorDb(err);
    if (http) return res.status(http.status).json({ error: http.message });
    console.error(`Error en ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  app.use('/api', api);

  const publico = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(publico));

  return app;
}
