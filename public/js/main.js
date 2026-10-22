import { FilesetResolver, HandLandmarker, DrawingUtils }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { clasificar, mayoria } from './gestos.js';
import { TIROS, LE_GANA_A, LO_VENCE, resultadoDe, predecir, decidir, perfil } from './ia.js';
import { ICONO_TIRO, icono, iconoTiro, ponerConIcono } from './iconos.js';
import { api } from './api.js';
import { sonido, confeti, desbloquearAudio, alternarSilencio } from './efectos.js';
import { crearVoz } from './voz.js';

/* ---------- Ajustes de tiempo (ms) ---------- */
const PAUSA_PALABRA = 600;        // entre "Piedra… Papel… Tijera…"
const VENTANA_TIRO = [100, 500];  // después del "¡Ya!": aquí se lee tu tiro
const INICIO_TARDIO = 700;        // a partir de aquí, si cambias de gesto es "tiro tardío"
const FIN_CAPTURA = 1200;

const NOMBRE_DIFICULTAD = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', imposible: 'Imposible' };
const NOMBRE_MODO = { libre: 'Libre', mejor_de_3: 'Mejor de 3', mejor_de_5: 'Mejor de 5' };
const META = { mejor_de_3: 2, mejor_de_5: 3 };

/* ---------- Elementos ---------- */
const $ = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'video', 'lienzoMano', 'cuenta', 'enVivo', 'tiroIa', 'textoIa', 'etiquetaJugador', 'conexion',
  'btnSonido', 'btnVoz', 'menu', 'nombre', 'btnEmpezar', 'mensajeMenu', 'juego', 'infoPartida',
  'progreso', 'btnTerminar', 'bienvenida', 'btnJugar', 'resultado', 'razon', 'tardio',
  'mJugador', 'mEmpates', 'mIa', 'predicciones', 'perfil', 'ranking', 'historial',
  'capa', 'capaEmoji', 'capaTitulo', 'capaTexto', 'btnRevancha', 'btnMenu',
  'estadoVoz', 'textoVoz', 'oido',
].map((id) => [id, $(id)]));
const tarjetaIa = el.tiroIa.parentElement;
const ctx = el.lienzoMano.getContext('2d');

/* ---------- Estado ---------- */
const estado = {
  jugador: null,       // { id, nombre }  (id = null si no hay servidor)
  dificultad: 'normal',
  modo: 'libre',
  partida: null,       // { id, ronda, victorias_jugador, victorias_ia, empates, terminada }
  historial: [],       // todas tus rondas que la IA recuerda: { tiro, resultado }
  global: null,        // estadísticas de todos los jugadores (modo difícil)
  predicciones: { intentos: 0, aciertos: 0 },
  ocupado: false,
};

let detector = null;
let dibujante = null;
let gestoActual = null;
let capturando = false;
let fotogramas = [];   // { t, gesto } durante la captura

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* =====================================================================
   1. Cámara y detección de la mano
   ===================================================================== */
async function iniciarCamara() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, audio: false,
    });
    el.video.srcObject = stream;
    await new Promise((r) => (el.video.onloadeddata = r));
    el.lienzoMano.width = el.video.videoWidth;
    el.lienzoMano.height = el.video.videoHeight;
  } catch (err) {
    console.error(err);
    ponerConIcono(el.enVivo, 'fa-video-slash', 'No pude acceder a la cámara');
    return;
  }

  try {
    el.enVivo.textContent = 'Cargando modelo de manos…';
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    detector = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  } catch (err) {
    console.error(err);
    el.enVivo.textContent = 'No pude cargar el modelo de manos';
    return;
  }

  dibujante = new DrawingUtils(ctx);
  el.btnEmpezar.disabled = false;
  requestAnimationFrame(bucle);
}

let ultimoTiempoVideo = -1;
function bucle() {
  if (el.video.currentTime !== ultimoTiempoVideo) {
    ultimoTiempoVideo = el.video.currentTime;
    const res = detector.detectForVideo(el.video, performance.now());
    ctx.clearRect(0, 0, el.lienzoMano.width, el.lienzoMano.height);

    if (res.landmarks?.length) {
      const puntos = res.landmarks[0];
      dibujante.drawConnectors(puntos, HandLandmarker.HAND_CONNECTIONS, { color: '#6c8cff', lineWidth: 4 });
      dibujante.drawLandmarks(puntos, { color: '#ffffff', radius: 3 });
      gestoActual = clasificar(puntos);
    } else {
      gestoActual = null;
    }

    if (capturando && gestoActual) fotogramas.push({ t: performance.now(), gesto: gestoActual });
    // Solo se redibuja la etiqueta cuando cambia el gesto
    if (gestoActual !== gestoMostrado) {
      gestoMostrado = gestoActual;
      if (gestoActual) el.enVivo.replaceChildren('Detecto: ', iconoTiro(gestoActual), ` ${gestoActual}`);
      else el.enVivo.textContent = 'Muestra tu mano a la cámara';
    }
  }
  requestAnimationFrame(bucle);
}
let gestoMostrado;

/* =====================================================================
   2. Conexión con el servidor
   ===================================================================== */
function pintarConexion() {
  el.conexion.textContent = api.disponible ? '● Guardando en Supabase' : '● Modo local (sin guardar)';
  el.conexion.className = `chip ${api.disponible ? 'ok' : 'local'}`;
}

function sinConexion(error) {
  console.warn('Servidor no disponible:', error?.message);
  api.marcarCaido();
  pintarConexion();
}

async function cargarRanking() {
  if (!api.disponible) {
    el.ranking.innerHTML = '<p class="nota">Conecta el servidor para ver el ranking.</p>';
    return;
  }
  try {
    const filas = await api.ranking();
    if (!filas.length) {
      el.ranking.innerHTML = '<p class="nota">Nadie ha jugado 10 rondas en Normal o Difícil todavía. ¡Sé el primero!</p>';
      return;
    }
    const tabla = document.createElement('table');
    tabla.innerHTML = '<thead><tr><th>#</th><th>Jugador</th><th class="num">Rondas</th><th class="num">% victorias</th></tr></thead>';
    const cuerpo = document.createElement('tbody');
    filas.forEach((f, i) => {
      const tr = document.createElement('tr');
      if (estado.jugador && f.nombre.toLowerCase() === estado.jugador.nombre.toLowerCase()) tr.className = 'tu';
      // textContent (no innerHTML) para que un nombre no pueda inyectar HTML
      [i + 1, f.nombre, f.rondas, `${f.porcentaje_victorias}%`].forEach((valor, col) => {
        const td = document.createElement('td');
        td.textContent = valor;
        if (col >= 2) td.className = 'num';
        tr.appendChild(td);
      });
      cuerpo.appendChild(tr);
    });
    tabla.appendChild(cuerpo);
    el.ranking.replaceChildren(tabla);
  } catch (err) {
    el.ranking.innerHTML = '<p class="nota">No se pudo cargar el ranking.</p>';
    console.warn(err);
  }
}

/* =====================================================================
   3. Menú y partidas
   ===================================================================== */
const opcionElegida = (nombre) => document.querySelector(`input[name="${nombre}"]:checked`).value;

async function prepararJugador(nombre) {
  // Mismo jugador que antes: ya tenemos su historial en memoria
  if (estado.jugador && estado.jugador.nombre.toLowerCase() === nombre.toLowerCase()) return;

  estado.historial = [];
  estado.predicciones = { intentos: 0, aciertos: 0 };
  estado.jugador = { id: null, nombre };

  if (!api.disponible) return;
  try {
    estado.jugador = await api.registrarJugador(nombre);
    const filas = await api.historial(estado.jugador.id);
    estado.historial = filas.map((f) => ({ tiro: f.tiro_jugador, resultado: f.resultado }));
  } catch (err) {
    sinConexion(err);
  }
}

async function nuevaPartida() {
  estado.global = null;
  if (estado.dificultad === 'dificil' && api.disponible) {
    try { estado.global = await api.estadisticas(); } catch (err) { sinConexion(err); }
  }

  estado.partida = { id: null, ronda: 0, victorias_jugador: 0, victorias_ia: 0, empates: 0, terminada: false };
  if (api.disponible && estado.jugador.id) {
    try {
      const p = await api.crearPartida(estado.jugador.id, estado.dificultad, estado.modo);
      estado.partida.id = p.id;
    } catch (err) {
      sinConexion(err);
    }
  }

  el.historial.replaceChildren();
  el.resultado.textContent = '';
  el.resultado.className = 'resultado';
  el.razon.textContent = '';
  el.tardio.textContent = '';
  reiniciarIa();
  pintarMarcador();
  pintarPerfil();
  pintarBienvenida();
}

function pintarBienvenida() {
  const { jugador, historial, global, dificultad } = estado;
  let texto;
  if (dificultad === 'imposible') {
    texto = `Suerte, ${jugador.nombre}. En este modo AURA puede ver tu mano antes de tirar.`;
  } else if (historial.length) {
    const p = perfil(historial);
    texto = `Bienvenido de vuelta, ${jugador.nombre}. AURA recuerda ${historial.length} rondas tuyas: ` +
            `sacas ${p.favorito} el ${p.porcentajes[p.favorito]}% de las veces.`;
  } else {
    texto = `Hola, ${jugador.nombre}. AURA todavía no te conoce… por ahora.`;
  }
  if (dificultad === 'dificil' && global?.total_rondas) {
    texto += ` Además estudió ${global.total_rondas} rondas de ${global.total_jugadores} jugador${global.total_jugadores === 1 ? '' : 'es'}.`;
  }
  el.bienvenida.textContent = texto;
}

function mostrarJuego() {
  el.menu.hidden = true;
  el.juego.hidden = false;
  el.etiquetaJugador.textContent = estado.jugador.nombre;
  el.btnJugar.focus();
}

function mostrarMenu() {
  el.capa.hidden = true;
  el.juego.hidden = true;
  el.menu.hidden = false;
  cargarRanking();
}

// Devuelve true si la partida arrancó (lo usa también el comando de voz)
async function empezar() {
  if (el.btnEmpezar.disabled) return false; // la cámara aún no está lista, o ya se está preparando
  const nombre = el.nombre.value.trim();
  if (!nombre) {
    el.mensajeMenu.textContent = 'Escribe tu nombre para que AURA te recuerde.';
    el.nombre.focus();
    return false;
  }
  guardarPreferencia('aura-nombre', nombre);

  estado.dificultad = opcionElegida('dificultad');
  estado.modo = opcionElegida('modo');
  el.btnEmpezar.disabled = true;
  el.mensajeMenu.textContent = 'Preparando partida…';
  try {
    await prepararJugador(nombre);
    await nuevaPartida();
    el.mensajeMenu.textContent = '';
    mostrarJuego();
    return true;
  } catch (err) {
    console.error(err);
    el.mensajeMenu.textContent = `No se pudo iniciar: ${err.message}`;
    return false;
  } finally {
    el.btnEmpezar.disabled = false;
  }
}

el.btnEmpezar.addEventListener('click', () => {
  desbloquearAudio();
  empezar();
});

/* =====================================================================
   4. Una ronda
   ===================================================================== */
function reiniciarIa() {
  el.tiroIa.replaceChildren(icono('fa-robot'));
  el.tiroIa.className = 'grande';
  el.textoIa.textContent = 'Esperando…';
  tarjetaIa.classList.remove('gana', 'pierde');
}

function revelarIa(tiro) {
  el.tiroIa.className = 'grande';
  void el.tiroIa.offsetWidth; // reinicia la animación
  el.tiroIa.classList.add('revelado');
  el.tiroIa.replaceChildren(iconoTiro(tiro));
  el.textoIa.textContent = tiro;
}

async function jugarRonda() {
  const p = estado.partida;
  if (estado.ocupado || !detector || !p || p.terminada || el.juego.hidden) return;
  estado.ocupado = true;
  el.btnJugar.disabled = true;
  el.btnTerminar.disabled = true;
  el.resultado.textContent = '';
  el.resultado.className = 'resultado';
  el.razon.textContent = '';
  el.tardio.textContent = '';
  tarjetaIa.classList.remove('gana', 'pierde');

  // La IA decide ANTES de ver tu mano (salvo en "imposible", que hace trampa)
  const imposible = estado.dificultad === 'imposible';
  const prediccion = predecir(estado.dificultad, estado.historial, estado.global);
  let decision = imposible ? null : decidir(estado.dificultad, prediccion);

  el.tiroIa.replaceChildren(iconoTiro('piedra'));
  el.tiroIa.className = 'grande agitando';
  el.textoIa.textContent = imposible ? 'Mirando tu mano…' : 'Pensando…';

  el.cuenta.className = 'cuenta';
  for (const palabra of ['Piedra…', 'Papel…', 'Tijera…']) {
    el.cuenta.textContent = palabra;
    sonido.tic();
    await esperar(PAUSA_PALABRA);
  }

  // ¡Ya! — ambos tiran al mismo tiempo
  el.cuenta.textContent = '¡Ya!';
  el.cuenta.className = 'cuenta ya';
  sonido.ya();
  const t0 = performance.now();
  fotogramas = [];
  capturando = true;
  if (decision) revelarIa(decision.tiro);

  await esperar(VENTANA_TIRO[1]);
  const enVentana = (desde, hasta) =>
    fotogramas.filter((f) => f.t - t0 >= desde && f.t - t0 <= hasta).map((f) => f.gesto);
  const tiroJugador = mayoria(enVentana(VENTANA_TIRO[0], VENTANA_TIRO[1]));

  if (imposible && tiroJugador) {
    decision = { tiro: LO_VENCE[tiroJugador], usada: false };
    revelarIa(decision.tiro);
  }

  await esperar(FIN_CAPTURA - VENTANA_TIRO[1]);
  capturando = false;
  el.cuenta.textContent = '';
  el.cuenta.className = 'cuenta';
  const tiroDespues = mayoria(enVentana(INICIO_TARDIO, Infinity));

  if (!tiroJugador) {
    reiniciarIa();
    el.resultado.textContent = tiroDespues
      ? 'Llegaste tarde: tu tiro tiene que estar listo en el «¡Ya!»'
      : 'No reconocí tu tiro, intenta otra vez';
    terminarTurno();
    return;
  }

  // ---------- Resultado ----------
  const resultado = resultadoDe(tiroJugador, decision.tiro);
  const MENSAJE = {
    gana_jugador: ['fa-star', '¡Ganaste!'],
    gana_ia: ['fa-robot', 'Gana AURA'],
    empate: ['fa-handshake', 'Empate'],
  };
  ponerConIcono(el.resultado, ...MENSAJE[resultado]);
  el.resultado.classList.add(resultado);
  if (resultado === 'gana_jugador') { sonido.gana(); confeti({ cantidad: 60, duracion: 1600 }); tarjetaIa.classList.add('pierde'); }
  else if (resultado === 'gana_ia') { sonido.pierde(); tarjetaIa.classList.add('gana'); }
  else sonido.empate();

  // ¿Explicación de la IA?
  if (estado.dificultad === 'facil') {
    el.razon.textContent = 'Modo fácil: AURA tira al azar.';
  } else if (imposible) {
    ponerConIcono(el.razon, 'fa-user-secret', 'Modo imposible: AURA esperó a ver tu mano antes de tirar.');
  } else if (decision.usada) {
    estado.predicciones.intentos++;
    const acerto = prediccion.tiro === tiroJugador;
    if (acerto) estado.predicciones.aciertos++;
    el.razon.textContent =
      `AURA predijo que sacarías ${prediccion.tiro} (${Math.round(prediccion.confianza * 100)}%) ` +
      `por ${prediccion.razon}, y ${acerto ? 'acertó' : 'falló'}.`;
  } else {
    el.razon.textContent = estado.historial.length < 3
      ? 'AURA tiró al azar: todavía está aprendiendo cómo juegas.'
      : 'AURA tiró al azar esta vez para no ser predecible.';
  }

  // ¿Cambió de gesto después del "¡Ya!"?
  const tiroTardio = Boolean(tiroDespues && tiroDespues !== tiroJugador);
  if (tiroTardio) {
    sonido.trampa();
    const leHubieraGanado = LE_GANA_A[tiroDespues] === decision.tiro;
    ponerConIcono(el.tardio, 'fa-eye',
      `Te vi cambiar a ${tiroDespues} después del «¡Ya!»` +
      (leHubieraGanado ? ' para ganarle a AURA' : '') + '. Cuenta tu primer tiro.');
  }

  // ---------- Actualizar estado ----------
  p.ronda++;
  if (resultado === 'gana_jugador') p.victorias_jugador++;
  else if (resultado === 'gana_ia') p.victorias_ia++;
  else p.empates++;

  // Las rondas en "imposible" no le enseñan nada útil a la IA... pero sí cómo juegas tú
  estado.historial.push({ tiro: tiroJugador, resultado });
  agregarAlHistorial(tiroJugador, decision.tiro, resultado, tiroTardio);
  pintarMarcador();
  pintarPerfil();

  guardarRonda({
    numero: p.ronda,
    tiro_jugador: tiroJugador,
    tiro_ia: decision.tiro,
    prediccion: decision.usada ? prediccion.tiro : null,
    tiro_tardio: tiroTardio,
  });

  const ganador = ganadorTorneo();
  if (ganador) {
    p.terminada = true;
    await esperar(1200);
    mostrarFinDePartida(ganador);
  }
  terminarTurno();
}

function terminarTurno() {
  estado.ocupado = false;
  el.btnJugar.disabled = estado.partida.terminada;
  el.btnTerminar.disabled = false;
}

async function guardarRonda(ronda) {
  const p = estado.partida;
  if (!p.id || !api.disponible) return;
  try {
    await api.registrarRonda(p.id, ronda);
  } catch (err) {
    sinConexion(err);
  }
}

function ganadorTorneo() {
  const meta = META[estado.modo];
  const p = estado.partida;
  if (!meta) return null;
  if (p.victorias_jugador >= meta) return 'jugador';
  if (p.victorias_ia >= meta) return 'ia';
  return null;
}

/* =====================================================================
   5. Pintar marcador, perfil e historial
   ===================================================================== */
function pintarMarcador() {
  const p = estado.partida;
  el.mJugador.textContent = p.victorias_jugador;
  el.mEmpates.textContent = p.empates;
  el.mIa.textContent = p.victorias_ia;

  el.infoPartida.textContent =
    `${NOMBRE_DIFICULTAD[estado.dificultad]} · ${NOMBRE_MODO[estado.modo]} · Ronda ${p.ronda + (p.terminada ? 0 : 1)}`;

  const meta = META[estado.modo];
  el.progreso.replaceChildren();
  if (meta) {
    for (const [quien, victorias] of [['Tú', p.victorias_jugador], ['AURA', p.victorias_ia]]) {
      const grupo = document.createElement('div');
      grupo.className = 'puntos';
      grupo.append(quien);
      for (let i = 0; i < meta; i++) {
        const punto = document.createElement('span');
        punto.className = 'punto';
        if (i < victorias) punto.classList.add(quien === 'Tú' ? 'lleno-jugador' : 'lleno-ia');
        grupo.appendChild(punto);
      }
      el.progreso.appendChild(grupo);
    }
  }

  const { intentos, aciertos } = estado.predicciones;
  el.predicciones.textContent = intentos
    ? `Predicciones de AURA: ${aciertos}/${intentos} acertadas (${Math.round((aciertos / intentos) * 100)}%)`
    : 'AURA aún no ha intentado predecir.';
}

function pintarPerfil() {
  const p = perfil(estado.historial);
  if (!p.total) {
    el.perfil.innerHTML = '<p class="nota">Juega unas rondas para ver cómo juegas.</p>';
    return;
  }
  el.perfil.replaceChildren();
  for (const tiro of TIROS) {
    const fila = document.createElement('div');
    fila.className = 'barra';
    fila.innerHTML = `<span><i class="fa-solid ${ICONO_TIRO[tiro]}" aria-hidden="true"></i> ${tiro}</span>` +
      '<div class="pista"><div class="relleno"></div></div><span class="pct"></span>';
    fila.querySelector('.relleno').style.width = `${p.porcentajes[tiro]}%`;
    fila.querySelector('.pct').textContent = `${p.porcentajes[tiro]}%`;
    el.perfil.appendChild(fila);
  }
  const nota = document.createElement('p');
  nota.className = 'nota';
  nota.textContent = `AURA recuerda ${p.total} rondas tuyas.` +
    (p.trasPerder ? ` Después de perder sueles sacar ${p.trasPerder.tiro} (${p.trasPerder.pct}%).` : '');
  el.perfil.appendChild(nota);
}

function agregarAlHistorial(tiroJugador, tiroIa, resultado, tardio) {
  const etiqueta = { gana_jugador: 'ganaste', gana_ia: 'perdiste', empate: 'empate' }[resultado];
  const li = document.createElement('li');
  li.className = resultado;
  li.append('Tú ', iconoTiro(tiroJugador), ' vs AURA ', iconoTiro(tiroIa), ` — ${etiqueta}`);
  if (tardio) li.append(' ', icono('fa-eye'));
  el.historial.prepend(li);
}

/* =====================================================================
   6. Fin de partida
   ===================================================================== */
function mostrarFinDePartida(ganador) {
  const p = estado.partida;
  const torneo = Boolean(META[estado.modo]);
  const textos = {
    jugador: ['fa-trophy', torneo ? '¡Campeón! Le ganaste a AURA' : '¡Le ganaste a AURA!'],
    ia: ['fa-robot', torneo ? 'AURA gana el torneo' : 'AURA ganó esta vez'],
    empate: ['fa-handshake', 'Empate'],
  };
  const [nombreIcono, titulo] = textos[ganador];
  el.capaEmoji.replaceChildren(icono(nombreIcono));
  el.capaTitulo.textContent = titulo;
  const { intentos, aciertos } = estado.predicciones;
  el.capaTexto.textContent =
    `Marcador final: Tú ${p.victorias_jugador} – ${p.victorias_ia} AURA (${p.empates} empates).` +
    (intentos ? ` AURA adivinó ${aciertos} de ${intentos} tiros.` : '');
  el.capa.hidden = false;
  el.btnRevancha.focus();

  if (ganador === 'jugador') {
    sonido.campeon();
    confeti();
  }
}

el.btnTerminar.addEventListener('click', async () => {
  const p = estado.partida;
  if (estado.ocupado || !p) return;
  if (p.ronda === 0) return mostrarMenu();

  p.terminada = true;
  el.btnJugar.disabled = true;
  if (p.id && api.disponible) {
    try { await api.terminarPartida(p.id); } catch (err) { sinConexion(err); }
  }
  const ganador = p.victorias_jugador > p.victorias_ia ? 'jugador'
    : p.victorias_ia > p.victorias_jugador ? 'ia' : 'empate';
  mostrarFinDePartida(ganador);
});

async function revancha() {
  el.capa.hidden = true;
  await nuevaPartida();
  el.btnJugar.disabled = false;
  el.btnJugar.focus();
}

el.btnRevancha.addEventListener('click', revancha);
el.btnMenu.addEventListener('click', mostrarMenu);

/* =====================================================================
   7. Controles: botón, teclado y sonido
   ===================================================================== */
el.btnJugar.addEventListener('click', () => { desbloquearAudio(); jugarRonda(); });

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || el.juego.hidden || !el.capa.hidden) return;
  if (e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  jugarRonda();
});

el.btnSonido.addEventListener('click', () => {
  const silenciado = alternarSilencio();
  el.btnSonido.replaceChildren(icono(silenciado ? 'fa-volume-xmark' : 'fa-volume-high'));
  el.btnSonido.title = silenciado ? 'Activar sonido' : 'Silenciar sonido';
});

/* =====================================================================
   8. Comando de voz: «Hey Aura»
   ===================================================================== */
function leerPreferencia(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function guardarPreferencia(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

// Muestra lo último que escuchó el micrófono (útil para ver si te está entendiendo)
let temporizadorOido = null;
function mostrarOido(texto) {
  el.oido.textContent = texto.trim() ? `«${texto.trim()}»` : '';
  clearTimeout(temporizadorOido);
  temporizadorOido = setTimeout(() => { el.oido.textContent = ''; }, 2500);
}

// «Hey Aura» hace lo que toque según la pantalla en la que estés:
//   menú → empieza la partida y la primera ronda · partida → juega una ronda · fin → revancha
let atendiendo = false;
async function alDespertar() {
  if (estado.ocupado || atendiendo) return;
  atendiendo = true;
  try {
    sonido.despertar();
    el.estadoVoz.classList.remove('desperto');
    void el.estadoVoz.offsetWidth; // reinicia la animación
    el.estadoVoz.classList.add('desperto');

    if (!el.capa.hidden) {
      await revancha();
      await esperar(700);
    } else if (!el.menu.hidden) {
      if (!(await empezar())) return;
      await esperar(900);
    }
  } finally {
    atendiendo = false;
  }
  jugarRonda();
}

function pintarVoz(activa, error) {
  el.btnVoz.classList.toggle('activo', activa && !error);
  el.btnVoz.setAttribute('aria-pressed', String(activa));
  el.btnVoz.replaceChildren(icono(activa ? 'fa-microphone' : 'fa-microphone-slash'));
  el.btnVoz.title = activa ? 'Desactivar comandos de voz' : 'Activar comandos de voz («Hey Aura»)';
  el.estadoVoz.hidden = !activa && !error;
  el.estadoVoz.classList.toggle('error', Boolean(error));
  el.textoVoz.textContent = error || 'Di «Hey Aura» para jugar';
}

const voz = crearVoz({
  alDespertar,
  alOir: mostrarOido,
  alCambiarEstado: pintarVoz,
});

if (!voz) {
  el.btnVoz.disabled = true;
  el.btnVoz.title = 'Tu navegador no soporta comandos de voz (usa Chrome o Edge)';
} else if (leerPreferencia('aura-voz') !== 'off') {
  // La voz se activa sola al abrir la página (el navegador pedirá permiso del micrófono).
  voz.activar();
  // Si el navegador no la dejó arrancar sin un clic, se intenta de nuevo con el primer clic en la página
  document.addEventListener('pointerdown', (e) => {
    if (!voz.activa && !e.target.closest('#btnVoz') && leerPreferencia('aura-voz') !== 'off') voz.activar();
  }, { once: true });
}

el.btnVoz.addEventListener('click', () => {
  if (!voz) return;
  desbloquearAudio();
  if (voz.activa) {
    voz.desactivar();
    guardarPreferencia('aura-voz', 'off');
  } else {
    voz.activar();
    guardarPreferencia('aura-voz', 'on');
  }
});

/* =====================================================================
   Arranque
   ===================================================================== */
el.nombre.value = leerPreferencia('aura-nombre') || leerPreferencia('ppt-nombre') || '';
api.conectar().then(() => {
  pintarConexion();
  cargarRanking();
});
iniciarCamara();
