// Comandos de voz con la Web Speech API (Chrome y Edge; necesita internet).
// Palabra clave: «Hey Aura». Con decir solo eso, AURA arranca la ronda
// (también funciona «Hey Aura, piedra, papel o tijera»).

// Minúsculas, sin acentos ni signos: "¡Hey, Áura!" → "hey aura"
export function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// El reconocimiento no siempre escribe "hey aura": a veces entiende "ey aura",
// "oye aura", "hey laura" u "hey ora". Se aceptan esas variantes, y "aura" sola.
const SALUDO = '(?:hey|hei|ei|ey|eh|jey|jei|oye|oie|hola|ok|okay)';
const NOMBRE = '(?:aura|aurah|haura|laura|ora)';
const PALABRA_CLAVE = new RegExp(`\\b${SALUDO} ${NOMBRE}\\b|\\baura\\b`);

export const contienePalabraClave = (texto) => PALABRA_CLAVE.test(normalizar(texto));

const ERRORES = {
  'not-allowed': 'Sin permiso para usar el micrófono',
  'service-not-allowed': 'Sin permiso para usar el micrófono',
  'audio-capture': 'No encontré un micrófono',
  network: 'El reconocimiento de voz necesita internet',
};

export function crearVoz({ alDespertar, alOir, alCambiarEstado }) {
  const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconocimiento) return null;

  const rec = new Reconocimiento();
  rec.lang = 'es-MX';
  rec.continuous = true;      // escucha todo el tiempo, no solo una frase
  rec.interimResults = true;  // reacciona mientras hablas, sin esperar a que termines
  rec.maxAlternatives = 3;    // revisa varias interpretaciones de lo que dijiste

  let activa = false;
  let escuchando = false;
  let ultimoDisparo = 0;
  let fallosSeguidos = 0;
  // Un mismo resultado llega varias veces (parcial y final): se marca para no activar a AURA dos veces
  const yaUsados = new Set();

  rec.onstart = () => {
    escuchando = true;
  };

  rec.onresult = (evento) => {
    fallosSeguidos = 0;
    for (let i = evento.resultIndex; i < evento.results.length; i++) {
      const resultado = evento.results[i];
      alOir?.(resultado[0].transcript);
      if (yaUsados.has(i)) continue;

      const oyoPalabraClave = Array.from(resultado).some((alt) => contienePalabraClave(alt.transcript));
      if (!oyoPalabraClave) continue;
      yaUsados.add(i);
      if (Date.now() - ultimoDisparo > 2500) {
        ultimoDisparo = Date.now();
        alDespertar(resultado[0].transcript);
      }
    }
  };

  rec.onerror = (evento) => {
    // 'no-speech' y 'aborted' son normales (silencio o reinicio): no se reportan
    const mensaje = ERRORES[evento.error];
    if (!mensaje) return;
    if (evento.error === 'network') {
      fallosSeguidos++;
      alCambiarEstado(true, mensaje);
    } else {
      activa = false;
      alCambiarEstado(false, mensaje);
    }
  };

  // Chrome corta el reconocimiento cada cierto tiempo: si sigue activa, se reinicia sola.
  // Si viene fallando (por ejemplo sin internet), espera cada vez más antes de reintentar.
  rec.onend = () => {
    escuchando = false;
    yaUsados.clear();
    if (!activa) return;
    const espera = fallosSeguidos ? Math.min(8000, 1000 * 2 ** (fallosSeguidos - 1)) : 0;
    setTimeout(() => {
      if (!activa || escuchando) return;
      try {
        rec.start();
        if (!fallosSeguidos) alCambiarEstado(true);
      } catch { /* ya estaba iniciado */ }
    }, espera);
  };

  return {
    get activa() {
      return activa;
    },
    activar() {
      if (activa) return;
      activa = true;
      fallosSeguidos = 0;
      try { rec.start(); } catch { /* ya estaba iniciado */ }
      alCambiarEstado(true);
    },
    desactivar() {
      activa = false;
      rec.abort();
      alCambiarEstado(false);
    },
  };
}
