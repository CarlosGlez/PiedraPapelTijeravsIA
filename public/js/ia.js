// La "IA": predice tu siguiente tiro y elige el que le gana.
// El historial es una lista de { tiro, resultado } con resultado = 'gana_jugador' | 'gana_ia' | 'empate'.

export const TIROS = ['piedra', 'papel', 'tijera'];
export const LE_GANA_A = { piedra: 'tijera', papel: 'piedra', tijera: 'papel' }; // X le gana a LE_GANA_A[X]
export const LO_VENCE = { piedra: 'papel', papel: 'tijera', tijera: 'piedra' };  // LO_VENCE[X] le gana a X

export function resultadoDe(tiroJugador, tiroIa) {
  if (tiroJugador === tiroIa) return 'empate';
  return LE_GANA_A[tiroJugador] === tiroIa ? 'gana_jugador' : 'gana_ia';
}

const DESPUES_DE = { gana_jugador: 'ganar', gana_ia: 'perder', empate: 'empatar' };

// ---------- Utilidades de conteo ----------
const vacio = () => ({ piedra: 0, papel: 0, tijera: 0 });
const total = (c) => c.piedra + c.papel + c.tijera;
const masAlto = (c) => TIROS.reduce((a, b) => (c[b] > c[a] ? b : a));
const completar = (obj) => ({ ...vacio(), ...(obj || {}) });

// ¿Qué sacaste las veces que tus últimas k jugadas fueron iguales a las de ahora?
function porContexto(historial, k) {
  const tiros = historial.map((h) => h.tiro);
  const n = tiros.length;
  const cuenta = vacio();
  if (n < k + 1) return cuenta;
  const clave = tiros.slice(n - k).join(',');
  for (let i = k; i < n; i++) {
    if (tiros.slice(i - k, i).join(',') === clave) cuenta[tiros[i]]++;
  }
  return cuenta;
}

// ¿Qué sacas después de ganar / perder / empatar (según cómo te fue en la última ronda)?
function trasResultado(historial) {
  const cuenta = vacio();
  const ultimo = historial.at(-1)?.resultado;
  for (let i = 1; i < historial.length; i++) {
    if (historial[i - 1].resultado === ultimo) cuenta[historial[i].tiro]++;
  }
  return cuenta;
}

function frecuencia(historial) {
  const cuenta = vacio();
  historial.forEach((h) => cuenta[h.tiro]++);
  return cuenta;
}

// ---------- Normal: solo tus patrones ----------
function predecirNormal(historial) {
  if (historial.length < 3) return null;
  for (const k of [2, 1]) {
    const c = porContexto(historial, k);
    if (total(c) >= 2) {
      const tiro = masAlto(c);
      return { tiro, confianza: c[tiro] / total(c), razon: `el patrón de tus últimas ${k === 1 ? 'jugada' : '2 jugadas'}` };
    }
  }
  const c = frecuencia(historial);
  const tiro = masAlto(c);
  return { tiro, confianza: c[tiro] / total(c), razon: 'tu tiro más frecuente' };
}

// ---------- Difícil: combina varias "pistas" con pesos ----------
// Cada pista vota por un tiro según qué tan seguido ha pasado; las que tienen poca evidencia pesan menos.
function predecirDificil(historial, global) {
  const pistas = [];
  const agregar = (cuenta, peso, razon, minimo) => {
    const t = total(cuenta);
    if (t < minimo) return;
    const evidencia = Math.min(1, t / 6);
    pistas.push({ cuenta, t, peso: peso * evidencia, razon });
  };

  const ultimo = historial.at(-1);
  if (ultimo) {
    agregar(porContexto(historial, 2), 3, 'el patrón de tus últimas 2 jugadas', 2);
    agregar(porContexto(historial, 1), 2, `lo que sueles sacar después de ${ultimo.tiro}`, 2);
    agregar(trasResultado(historial), 2, `lo que haces después de ${DESPUES_DE[ultimo.resultado]}`, 2);
    agregar(frecuencia(historial), 1, 'tu tiro favorito', 3);
  }

  if (global?.total_rondas > 0) {
    const gente = `${global.total_jugadores} jugador${global.total_jugadores === 1 ? '' : 'es'}`;
    if (!ultimo) {
      agregar(completar(global.aperturas), 2, `cómo abren ${gente} su primera ronda`, 3);
    } else {
      agregar(completar(global.transiciones?.[ultimo.tiro]), 1.5, `lo que hacen ${gente} después de ${ultimo.tiro}`, 3);
      agregar(completar(global.tras_resultado?.[ultimo.resultado]), 1.5,
        `lo que hace la gente después de ${DESPUES_DE[ultimo.resultado]}`, 3);
    }
  }

  if (!pistas.length) return null;

  const puntaje = { piedra: 0, papel: 0, tijera: 0 };
  for (const p of pistas) for (const t of TIROS) puntaje[t] += (p.cuenta[t] / p.t) * p.peso;
  const tiro = masAlto(puntaje);
  const suma = total(puntaje);

  // La razón que se muestra es la pista que más empujó hacia ese tiro
  const principal = pistas.reduce((a, b) =>
    (b.cuenta[tiro] / b.t) * b.peso > (a.cuenta[tiro] / a.t) * a.peso ? b : a
  );
  return { tiro, confianza: puntaje[tiro] / suma, razon: principal.razon, pistas: pistas.length };
}

export function predecir(dificultad, historial, global) {
  if (dificultad === 'normal') return predecirNormal(historial);
  if (dificultad === 'dificil') return predecirDificil(historial, global);
  return null; // fácil tira al azar; imposible no necesita predecir: hace trampa
}

// Decide el tiro de la IA ANTES de ver tu mano (excepto en imposible, que se resuelve aparte).
export function decidir(dificultad, prediccion) {
  const azar = TIROS[Math.floor(Math.random() * 3)];
  if (dificultad === 'facil' || !prediccion) return { tiro: azar, usada: false };
  if (dificultad === 'normal') {
    // Si la predicción es débil, o un 10% de las veces, tira al azar para no ser predecible
    if (prediccion.confianza < 0.4 || Math.random() < 0.1) return { tiro: azar, usada: false };
  }
  if (dificultad === 'dificil' && prediccion.confianza < 0.36) return { tiro: azar, usada: false };
  return { tiro: LO_VENCE[prediccion.tiro], usada: true };
}

// Resumen de cómo juegas, para el panel "Tu perfil"
export function perfil(historial) {
  const c = frecuencia(historial);
  const t = total(c);
  const porcentajes = Object.fromEntries(TIROS.map((x) => [x, t ? Math.round((c[x] / t) * 100) : 0]));

  const trasPerder = vacio();
  for (let i = 1; i < historial.length; i++) {
    if (historial[i - 1].resultado === 'gana_ia') trasPerder[historial[i].tiro]++;
  }
  const tp = total(trasPerder);
  const tiroTrasPerder = tp >= 3 ? masAlto(trasPerder) : null;

  return {
    total: t,
    porcentajes,
    favorito: t ? masAlto(c) : null,
    trasPerder: tiroTrasPerder ? { tiro: tiroTrasPerder, pct: Math.round((trasPerder[tiroTrasPerder] / tp) * 100) } : null,
  };
}
