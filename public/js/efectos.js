// Sonidos (sintetizados con Web Audio, no necesitan archivos) y confeti.

let ctx = null;
let silencio = false;

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// El navegador solo deja reproducir audio después de un clic del usuario
export function desbloquearAudio() {
  try { audio(); } catch { /* sin audio, no pasa nada */ }
}

export function alternarSilencio() {
  silencio = !silencio;
  return silencio;
}

function nota(frecuencia, inicio, duracion, tipo = 'square', volumen = 0.07) {
  if (silencio) return;
  try {
    const a = audio();
    const osc = a.createOscillator();
    const gan = a.createGain();
    const t = a.currentTime + inicio;
    osc.type = tipo;
    osc.frequency.value = frecuencia;
    gan.gain.setValueAtTime(volumen, t);
    gan.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    osc.connect(gan).connect(a.destination);
    osc.start(t);
    osc.stop(t + duracion + 0.05);
  } catch { /* sin audio */ }
}

export const sonido = {
  despertar: () => { nota(660, 0, 0.12, 'sine', 0.12); nota(990, 0.1, 0.2, 'sine', 0.12); },
  tic: () => nota(440, 0, 0.12),
  ya: () => nota(880, 0, 0.3),
  gana: () => [523, 659, 784, 1047].forEach((f, i) => nota(f, i * 0.1, 0.25, 'triangle', 0.1)),
  pierde: () => [392, 330, 262].forEach((f, i) => nota(f, i * 0.16, 0.3, 'sawtooth', 0.05)),
  empate: () => { nota(523, 0, 0.15, 'triangle', 0.08); nota(523, 0.2, 0.15, 'triangle', 0.08); },
  trampa: () => [988, 740, 988, 740].forEach((f, i) => nota(f, i * 0.09, 0.08, 'square', 0.05)),
  campeon: () => [523, 659, 784, 659, 784, 1047].forEach((f, i) => nota(f, i * 0.13, 0.3, 'triangle', 0.1)),
};

const COLORES = ['#6c8cff', '#3ddc97', '#ffc857', '#ff5d73', '#c38bff', '#ffffff'];

export function confeti({ cantidad = 160, duracion = 2800 } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lienzo = document.createElement('canvas');
  lienzo.className = 'confeti';
  document.body.appendChild(lienzo);
  const c = lienzo.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const ancho = (lienzo.width = innerWidth * dpr);
  const alto = (lienzo.height = innerHeight * dpr);

  const piezas = Array.from({ length: cantidad }, () => ({
    x: Math.random() * ancho,
    y: -Math.random() * alto * 0.5,
    vx: (Math.random() - 0.5) * 4 * dpr,
    vy: (2 + Math.random() * 4) * dpr,
    giro: Math.random() * Math.PI,
    vgiro: (Math.random() - 0.5) * 0.3,
    tam: (6 + Math.random() * 6) * dpr,
    color: COLORES[Math.floor(Math.random() * COLORES.length)],
  }));

  const inicio = performance.now();
  (function cuadro(ahora) {
    const t = ahora - inicio;
    c.clearRect(0, 0, ancho, alto);
    c.globalAlpha = t > duracion - 600 ? Math.max(0, (duracion - t) / 600) : 1;
    for (const p of piezas) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05 * dpr;
      p.giro += p.vgiro;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.giro);
      c.fillStyle = p.color;
      c.fillRect(-p.tam / 2, -p.tam / 4, p.tam, p.tam / 2);
      c.restore();
    }
    if (t < duracion) requestAnimationFrame(cuadro);
    else lienzo.remove();
  })(inicio);
}
